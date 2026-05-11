# Requirements Document

## Introduction

The lead search application currently uses a synchronous request/response pattern where the `dataforseoBusinessSearch` Cloud Function performs the entire pipeline (geocoding, DFS API search, cache lookup, Instant Pages fetch, Lighthouse analysis, RDAP domain lookups, scoring) in a single HTTP request. Firebase Hosting proxies `/api/search` to this function but enforces a hard 60-second timeout that cannot be changed. Searches involving uncached businesses routinely take 60–120+ seconds, causing 502 errors at the Hosting proxy layer despite the function's 300-second timeout.

This feature replaces the synchronous pattern with a job-based architecture: the frontend POSTs to create a job document in Firestore, a Firestore `onCreate` trigger fires a separate Cloud Function to process the pipeline asynchronously, and the frontend uses a Firestore `onSnapshot` listener to receive real-time updates as results stream in.

## Glossary

- **Job**: A Firestore document in the `jobs` collection representing a single search request, containing its status, progress, and final metadata.
- **Job_Creator**: An HTTP-triggered Cloud Function that validates input, creates a Job document in Firestore with a deterministic ID, and returns the job ID to the caller. This is the function behind the `/api/search` endpoint.
- **Job_Processor**: A Firestore `onCreate`-triggered Cloud Function that fires when a new Job document is created. It runs the existing search Pipeline asynchronously and writes progress and results back to the Job document and Results_Subcollection. Configured with retries disabled to prevent duplicate API credit consumption.
- **Job_Canceller**: An HTTP-triggered Cloud Function behind `/api/search/cancel` that sets a Job document's status to `"cancelled"`. All writes to Job documents go through server-side Admin SDK; the frontend never writes directly.
- **Job_Listener**: The frontend component that subscribes to a Job document and its Results_Subcollection via Firestore `onSnapshot` to receive real-time status and result updates.
- **Pipeline**: The existing sequence of operations: geocoding → DFS business search → cache lookup → Instant Pages fetch → Lighthouse analysis → RDAP domain lookups → scoring.
- **Search_API**: The `/api/search` HTTP endpoint proxied by Firebase Hosting to the Job_Creator Cloud Function.
- **Hosting_Proxy**: Firebase Hosting's rewrite layer that forwards requests to Cloud Functions, subject to a 60-second timeout.
- **Results_Subcollection**: A Firestore subcollection (`jobs/{jobId}/results`) used to store individual scored business documents, avoiding the 1 MB Firestore document size limit on the parent Job document.
- **Deterministic_Job_ID**: A hash of `uid + keyword + location + radius` used as the Firestore document ID for a Job, ensuring that identical concurrent requests map to the same document and preventing race-condition duplicates.

## Requirements

### Requirement 1: Job Creation

**User Story:** As a user, I want my search request to return immediately with a job reference, so that the request completes well within the Hosting proxy timeout and I am not shown a 502 error.

#### Acceptance Criteria

1. WHEN a user submits a valid search request, THE Job_Creator SHALL validate the input, create a Job document in Firestore with status `"running"`, and return the job ID in the HTTP response within 2 seconds.
2. WHEN a user submits a search request with invalid input, THE Job_Creator SHALL return an appropriate HTTP error status and descriptive message without creating a Job document.
3. WHEN a user submits a search request without a valid Firebase Auth token, THE Job_Creator SHALL return HTTP 401 and not create a Job document.
4. THE Job_Creator SHALL store the authenticated user's UID on the Job document so that security rules can restrict access to the owning user.
5. WHEN a Job document is created, THE Job_Creator SHALL record the search parameters (keyword, location, radius) on the Job document.

### Requirement 2: Trigger Mechanism

**User Story:** As a developer, I want the processing pipeline to be triggered automatically and reliably when a job is created, so that the architecture has clear separation between job creation and processing.

#### Acceptance Criteria

1. THE Job_Processor SHALL be implemented as a Firestore `onCreate` trigger on the `jobs` collection, firing as a separate Cloud Function from the Job_Creator.
2. WHEN a new Job document is created, THE Job_Processor SHALL begin executing the Pipeline using the search parameters stored on the Job document.
3. THE Job_Processor SHALL be configured with a 300-second timeout to accommodate long-running searches.
4. THE Job_Processor SHALL be configured with retries disabled (`failurePolicy` not set or explicitly absent) so that a crash does not re-trigger the pipeline and burn duplicate API credits. Stuck jobs are handled by the cleanup mechanism in Requirement 8.

### Requirement 3: Background Processing

**User Story:** As a user, I want the search pipeline to run in the background after job creation, so that long-running analysis does not block the HTTP response.

#### Acceptance Criteria

1. WHEN the Job_Processor is triggered, THE Job_Processor SHALL execute the existing Pipeline (geocoding, DFS search, cache lookup, Instant Pages, Lighthouse, RDAP, scoring) using the search parameters stored on the Job document.
2. WHILE the Pipeline is executing, THE Job_Processor SHALL write progress updates to the Job document including the count of businesses analyzed so far and the total count of businesses to analyze, batching updates to write no more frequently than once per scored batch of businesses (where a batch is the set of no-website businesses, dead-site businesses, parked businesses, or the non-parked businesses scored after Lighthouse/RDAP).
3. WHILE the Pipeline is executing, THE Job_Processor SHALL write scored business results to the Results_Subcollection incrementally as each batch of businesses is scored.
4. WHEN the Pipeline completes successfully, THE Job_Processor SHALL update the Job document status to `"completed"`, include the cost breakdown, and set a `resultCount` field equal to the total number of documents written to the Results_Subcollection.
5. IF the Pipeline encounters an unrecoverable error (geocoding failure, DFS API failure, missing environment variables), THEN THE Job_Processor SHALL update the Job document status to `"failed"` and include a user-facing error message.
6. WHEN the DFS business search returns zero results, THE Job_Processor SHALL set `progress` to `{ analyzed: 0, total: 0 }`, set `resultCount` to `0`, update the Job document status to `"completed"` with an empty Results_Subcollection, and include the cost breakdown. This is a successful completion, not an error.
7. IF individual enrichment steps fail for specific businesses (RDAP lookup timeout, Lighthouse failure for a single URL), THEN THE Job_Processor SHALL score those businesses with null values for the failed enrichment data and continue processing, matching existing module behavior.
8. WHEN the Pipeline completes, THE Job_Processor SHALL save newly scored businesses to the `businesses` cache collection and save the search to the user's `users/{uid}/searches` subcollection, preserving existing behavior.

### Requirement 4: Cancellation

**User Story:** As a user, I want to be able to cancel a running search, so that API credits are not wasted on results I no longer need.

#### Acceptance Criteria

1. WHEN the user requests cancellation of a running job, THE Job_Listener SHALL call the Job_Canceller endpoint (`/api/search/cancel`) with the job ID. The Job_Canceller SHALL verify the requesting user owns the job and update the Job document status to `"cancelled"` via the Admin SDK.
2. WHILE the Pipeline is executing, THE Job_Processor SHALL check the Job document status before each major pipeline stage (before DFS search, before Instant Pages, before Lighthouse/RDAP) and stop processing if the status is `"cancelled"`.
3. WHEN the Job_Processor detects a `"cancelled"` status, THE Job_Processor SHALL write any already-scored partial results to the Results_Subcollection, update the Job document status to `"cancelled"`, and stop further API calls.
4. WHERE the cancellation signal arrives while a batch operation is in-flight (e.g., mid-Lighthouse for 25 URLs), THE Job_Processor SHALL complete the in-flight batch before checking the cancellation status. This is a known limitation: cancellation is cooperative and checked between pipeline stages, not mid-batch.
5. THE Job_Canceller endpoint SHALL be registered as a Firebase Hosting rewrite at `/api/search/cancel` in `firebase.json`, so that the Hosting_Proxy routes cancel requests to the correct Cloud Function.

### Requirement 5: Real-time Frontend Updates

**User Story:** As a user, I want to see search results appear progressively as they are scored, so that I get useful information before the entire search completes.

#### Acceptance Criteria

1. WHEN the Job_Creator returns a job ID, THE Job_Listener SHALL subscribe to the Job document using a Firestore `onSnapshot` listener and subscribe to the Results_Subcollection using a separate `onSnapshot` listener.
2. WHILE the Job document status is `"running"` and the `progress.total` field is available and greater than zero, THE Job_Listener SHALL display a progress indicator showing the number of businesses analyzed out of the total (e.g., "Analyzing 15 of 49 websites…"). WHILE `progress.total` is not yet available, THE Job_Listener SHALL display a generic loading indicator (e.g., "Starting search…"). WHEN `progress.total` is zero, THE Job_Listener SHALL display "No businesses found in this area" once the status transitions to `"completed"`.
3. WHILE the Job document status is `"running"`, THE Job_Listener SHALL render partial results from the Results_Subcollection in the results table, sorted by score descending.
4. WHEN the Job document status changes to `"completed"`, THE Job_Listener SHALL wait until the local Results_Subcollection snapshot count matches the `resultCount` field on the Job document before displaying the final results and unsubscribing from both snapshot listeners. This prevents a race condition where the `"completed"` status snapshot arrives before the last batch of results from the subcollection listener.
5. WHEN the Job document status changes to `"failed"`, THE Job_Listener SHALL display the error message from the Job document and unsubscribe from both snapshot listeners.
6. WHEN the user navigates away during a running job, THE Job_Listener SHALL unsubscribe from both snapshot listeners.
7. IF either snapshot listener encounters an error (permissions failure, network drop, quota exceeded), THEN THE Job_Listener SHALL tear down both listeners and display an error state to the user.

### Requirement 6: Job Document Data Model

**User Story:** As a developer, I want a well-defined Job document schema, so that the backend and frontend have a clear contract for data exchange.

#### Acceptance Criteria

1. THE Job document SHALL contain the following fields: `uid` (string), `status` (one of `"running"`, `"completed"`, `"failed"`, `"cancelled"`), `params` (object with keyword, location, radius), `progress` (object with `analyzed` and `total` counts), `resultCount` (number, set on completion — the total number of documents written to the Results_Subcollection), `error` (string or null), `cost` (cost breakdown object or null), `createdAt` (server timestamp), `updatedAt` (server timestamp), and `ttl` (timestamp set to 24 hours after creation).
2. THE Results_Subcollection (`jobs/{jobId}/results/{cid}`) SHALL store individual scored business documents matching the existing `ScoredBusiness` type, avoiding the 1 MB Firestore document size limit.
3. WHEN the Job_Processor writes to the Job document, THE Job_Processor SHALL update the `updatedAt` timestamp on every write.

### Requirement 7: Duplicate Job Prevention

**User Story:** As a developer, I want to prevent duplicate jobs from being created when a user double-clicks or the client retries, so that API credits are not wasted on redundant searches.

#### Acceptance Criteria

1. THE Job_Creator SHALL compute a Deterministic_Job_ID by hashing the combination of the user's UID, keyword, location, and radius.
2. THE Job_Creator SHALL use Firestore `create()` semantics (which fail if the document already exists) with the Deterministic_Job_ID as the document ID.
3. IF the `create()` call fails because a document with that ID already exists AND the existing document has status `"running"`, THEN THE Job_Creator SHALL return the existing job ID to the caller.
4. IF the existing document has a terminal status (`"completed"`, `"failed"`, `"cancelled"`), THEN THE Job_Creator SHALL first delete all documents in the existing Results_Subcollection, then overwrite the Job document with a new `"running"` job using `set()`, effectively reusing the same document ID for a fresh search without inheriting stale results.

### Requirement 8: Job TTL and Cleanup

**User Story:** As a developer, I want job documents to be cleaned up automatically, so that Firestore storage does not grow unboundedly and stuck jobs are resolved promptly.

#### Acceptance Criteria

1. THE Job document SHALL include a `ttl` field set to 24 hours after creation.
2. A scheduled Cloud Function (the "TTL cleanup") SHALL run daily and delete Job documents where the `ttl` has passed. The cleanup function SHALL explicitly enumerate and delete all documents in the Results_Subcollection (`jobs/{jobId}/results`) before deleting the parent Job document, because Firestore does not cascade-delete subcollections.
3. A separate scheduled Cloud Function (the "stuck job cleanup") SHALL run every 5 minutes and query for Job documents with status `"running"` and `createdAt` older than 10 minutes. For each such document, the function SHALL update its status to `"failed"` with an error message indicating a timeout, so that stuck jobs are resolved promptly and the frontend does not show a perpetual loading state.

### Requirement 9: Firestore Security Rules

**User Story:** As a developer, I want Firestore security rules that protect job documents, so that users can only read their own jobs and cannot tamper with job data.

#### Acceptance Criteria

1. THE Firestore security rules SHALL allow authenticated users to read Job documents where the `uid` field matches the requesting user's UID.
2. THE Firestore security rules SHALL deny all client-side write access to Job documents and their Results_Subcollection, restricting all writes to the server-side Admin SDK.
3. THE Firestore security rules SHALL deny read access to Job documents for unauthenticated requests.
4. THE Firestore security rules SHALL allow authenticated users to read documents in the Results_Subcollection by checking a `uid` field stored directly on each result document (`resource.data.uid == request.auth.uid`), avoiding the cost of a `get()` call on the parent Job document. THE Job_Processor SHALL write the owning user's UID onto every result document in the Results_Subcollection.

### Requirement 10: Backward Compatibility

**User Story:** As a developer, I want the refactored architecture to preserve existing functionality, so that scoring, caching, search history, and other features continue to work.

#### Acceptance Criteria

1. THE Job_Processor SHALL use the existing scoring, DFS client, RDAP, and geocode modules without modification.
2. THE Job_Processor SHALL continue to write scored businesses to the `businesses` Firestore collection for caching, matching existing behavior.
3. THE Job_Processor SHALL continue to save completed searches to the `users/{uid}/searches` subcollection, matching existing behavior.
4. THE Search_API endpoint path (`/api/search`) SHALL remain unchanged so that the Firebase Hosting rewrite configuration does not need to change.
5. THE Job_Listener SHALL produce the same normalized `Business[]` data structure for the results table that the current synchronous flow produces.

### Requirement 11: Rate Limiting and Input Validation

**User Story:** As a developer, I want the job creation endpoint to enforce the same rate limiting and input validation as the current endpoint, so that abuse prevention is maintained.

#### Acceptance Criteria

1. THE Job_Creator SHALL enforce the same per-IP rate limiting (10 requests per minute) as the current synchronous endpoint.
2. THE Job_Creator SHALL apply the same input sanitization rules (max keyword length 120, max location length 200, safe character regex, radius clamped 1–100) as the current synchronous endpoint.

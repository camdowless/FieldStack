# Implementation Plan: Async Search Jobs

## Overview

Convert the synchronous `dataforseoBusinessSearch` Cloud Function into a job-based architecture with three Cloud Functions (Job_Creator, Job_Processor, Job_Canceller), two scheduled cleanup functions, Firestore security rules, and a frontend `useSearchJob` hook that replaces the fetch-and-wait pattern with real-time Firestore listeners.

## Tasks

- [x] 1. Add shared types and helper utilities
  - [x] 1.1 Add job-related TypeScript types to `functions/src/types.ts`
    - Add `JobDocument`, `JobStatus`, `JobParams`, `JobProgress`, `ResultDocument`, `CreateJobResponse`, `CancelJobResponse` interfaces
    - `JobDocument` includes `resultCount: number | null` field (null while running, set on completion)
    - _Requirements: 6.1, 6.2_
  - [x] 1.2 Create `functions/src/jobHelpers.ts` with deterministic job ID computation and subcollection cleanup
    - Implement `computeJobId(uid, keyword, location, radius)` using SHA-256 truncated to 20 hex chars
    - Implement `deleteResultsSubcollection(jobId)` with recursive batch deletion
    - Implement `isJobCancelled(jobId)` helper
    - _Requirements: 7.1, 7.4_
  - [x] 1.3 Write property tests for `computeJobId`
    - **Property 3: Deterministic job ID is a pure function**
    - **Validates: Requirements 7.1**

- [x] 2. Implement Job_Creator Cloud Function
  - [x] 2.1 Refactor `dataforseoBusinessSearch` in `functions/src/index.ts` into the Job_Creator
    - Keep existing auth verification, rate limiting, input validation/sanitization
    - Replace pipeline execution with: compute deterministic job ID, attempt `create()` on `jobs/{jobId}`, handle `ALREADY_EXISTS` (return existing ID if running, clear subcollection + `set()` if terminal), return `{ jobId }`
    - Set job doc fields: uid, status "running", params, progress {analyzed:0, total:0}, resultCount null, error null, cost null, createdAt, updatedAt, ttl (createdAt + 24h)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 7.1, 7.2, 7.3, 7.4, 8.1, 11.1, 11.2_
  - [x] 2.2 Write property test for invalid input rejection
    - **Property 2: Invalid input rejection**
    - **Validates: Requirements 1.2, 11.2**
  - [x] 2.3 Write property test for duplicate running job returns existing ID
    - **Property 4: Duplicate running job returns existing ID**
    - **Validates: Requirements 7.3**
  - [x] 2.4 Write property test for terminal job reuse clears stale results
    - **Property 5: Terminal job reuse clears stale results**
    - **Validates: Requirements 7.4**

- [x] 3. Implement Job_Processor Cloud Function
  - [x] 3.1 Create the `processSearchJob` Firestore onCreate trigger in `functions/src/index.ts`
    - Extract the existing pipeline logic from the old `dataforseoBusinessSearch` into a function that takes job params and jobId
    - Configure with `timeoutSeconds: 300`, no `failurePolicy` (retries disabled)
    - Read params from the created job document
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [x] 3.2 Implement pipeline execution with progress writes and cancellation checks
    - After DFS business search: write progress `{ analyzed: 0, total: N }` to job doc, check cancellation
    - After scoring no-website batch: write results to `jobs/{jobId}/results/{cid}` with uid field, update progress, check cancellation
    - After scoring dead-site + parked batches: write results, update progress, check cancellation
    - After scoring non-parked batch (Lighthouse + RDAP): write results, update progress
    - Track a running count of result documents written to the subcollection across all batches
    - On completion: set status "completed", write cost breakdown and `resultCount` (total docs written to Results_Subcollection) in the same atomic update
    - On zero DFS results: set progress {0,0}, resultCount 0, status "completed" immediately
    - On unrecoverable error: set status "failed" with error message
    - On cancellation detected: write partial results, set status "cancelled"
    - Fire-and-forget: save to businesses cache + user searches (existing behavior)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.2, 4.3, 10.1, 10.2, 10.3_
  - [x] 3.3 Write property test for pipeline completion invariant
    - **Property 6: Pipeline completion invariant**
    - **Validates: Requirements 3.2, 3.3, 3.4**
  - [x] 3.4 Write property test for partial enrichment failure
    - **Property 8: Partial enrichment failure produces null values, not aborts**
    - **Validates: Requirements 3.7**

- [x] 4. Checkpoint - Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement Job_Canceller Cloud Function
  - [x] 5.1 Create the `cancelSearchJob` HTTP function in `functions/src/index.ts`
    - Auth verification, read jobId from request body
    - Verify requesting user's UID matches job doc's uid
    - Update status to "cancelled" only if currently "running"
    - Return appropriate error codes for missing job, wrong owner, wrong status
    - _Requirements: 4.1, 4.5_
  - [x] 5.2 Write property test for cancel endpoint ownership check
    - **Property 11: Cancel endpoint ownership check**
    - **Validates: Requirements 4.1**

- [x] 6. Implement cleanup scheduled functions
  - [x] 6.1 Create `cleanupStuckJobs` scheduled function in `functions/src/index.ts`
    - Runs every 5 minutes via `functions.pubsub.schedule`
    - Query for jobs with status "running" and createdAt older than 10 minutes
    - Update each to status "failed" with timeout error message
    - _Requirements: 8.3_
  - [x] 6.2 Create `cleanupExpiredJobs` scheduled function in `functions/src/index.ts`
    - Runs daily via `functions.pubsub.schedule`
    - Query for jobs where ttl is in the past
    - For each: delete all Results_Subcollection documents, then delete the job document
    - _Requirements: 8.2_
  - [x] 6.3 Write property test for stuck job cleanup
    - **Property 17: Stuck job cleanup marks only old running jobs**
    - **Validates: Requirements 8.3**
  - [x] 6.4 Write property test for TTL cleanup
    - **Property 16: TTL cleanup deletes only expired jobs**
    - **Validates: Requirements 8.2**

- [x] 7. Update Firestore security rules and Firebase config
  - [x] 7.1 Add security rules for `jobs` collection and `results` subcollection in `firestore.rules`
    - Allow read on `jobs/{jobId}` if authenticated and `resource.data.uid == request.auth.uid`
    - Allow read on `jobs/{jobId}/results/{resultId}` if authenticated and `resource.data.uid == request.auth.uid`
    - Deny all client writes on both
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  - [x] 7.2 Add hosting rewrite for `/api/search/cancel` in `firebase.json`
    - Add rewrite entry before the existing `/api/search` entry
    - _Requirements: 4.5_

- [x] 8. Checkpoint - Ensure all backend functions compile and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement frontend `useSearchJob` hook
  - [x] 9.1 Create `frontend/src/hooks/useSearchJob.ts`
    - Implement `startSearch(params)`: call `/api/search` to get jobId, set up two `onSnapshot` listeners (job doc + results subcollection)
    - Implement `cancelSearch()`: call `/api/search/cancel` with jobId
    - Normalize results from subcollection snapshots via `normalizeBusiness()`
    - Sort results by score descending (null scores last)
    - Track status, progress, results, error, cost in state
    - On `"completed"` status: do NOT unsubscribe immediately — wait until local subcollection snapshot count matches `resultCount` from the job doc before tearing down listeners (prevents race where completion snapshot arrives before last results batch)
    - Tear down both listeners on failure, cancellation, unmount, or listener error
    - If either listener errors, tear down both and surface error state
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
  - [x] 9.2 Write property test for results sorted by score descending
    - **Property 14: Results sorted by score descending**
    - **Validates: Requirements 5.3**
  - [x] 9.3 Write property test for progress display state machine
    - **Property 15: Progress display state machine**
    - **Validates: Requirements 5.2**

- [x] 10. Update frontend API client and search page
  - [x] 10.1 Update `frontend/src/lib/api.ts`
    - Replace `searchBusinesses()` with `createSearchJob(params): Promise<{ jobId: string }>`
    - Add `cancelSearchJob(jobId): Promise<{ success: boolean }>`
    - Keep `fetchBusinessesByCids()`, `recalculateLegitimacy()`, `fetchGhostBusinesses()` unchanged
    - _Requirements: 10.4_
  - [x] 10.2 Update `frontend/src/pages/Index.tsx` to use `useSearchJob` hook
    - Replace `executeSearch` callback with `startSearch` from hook
    - Replace static loading spinner with progress indicator from hook state (generic "Starting search…" when total is null, "Analyzing X of Y websites…" when total > 0, "No businesses found" when completed with total 0)
    - Render partial results incrementally as they arrive
    - Replace fetch abort with `cancelSearch()` on cancel button
    - Keep results table, sorting, filtering, detail panel, CSV export unchanged
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 10.5_

- [x] 11. Checkpoint - Ensure frontend compiles and all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Wire everything together and final verification
  - [x] 12.1 Remove the old synchronous pipeline code from `functions/src/index.ts`
    - Remove the old `dataforseoBusinessSearch` function body (pipeline + timeout race)
    - Keep the export name mapped to the new Job_Creator
    - Verify all other exports (`recalculateLegitimacy`, `getGhostBusinesses`, `getBusinessesByCids`) are unchanged
    - _Requirements: 10.1, 10.4_
  - [x] 12.2 Write property test for normalization equivalence
    - **Property 12: Results normalization equivalence**
    - **Validates: Requirements 6.2, 10.5**

- [x] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests use `fast-check` library with minimum 100 iterations per test
- The existing scoring, DFS client, RDAP, and geocode modules are not modified — only the orchestration in `index.ts` changes
- The `SearchHistory.tsx` page uses `fetchBusinessesByCids()` to load results from cache, which is unaffected by this change

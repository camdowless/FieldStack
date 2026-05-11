# Implementation Plan: dataforseo-business-search

## Overview

Implement the `dataforseoBusinessSearch` Firebase HTTP function in TypeScript, broken into discrete modules: shared types, the isolated Scorer, the DataForSEO API client, the RDAP client, and the HTTP handler/pipeline orchestration. Property-based tests use `fast-check`.

## Tasks

- [x] 1. Set up shared types and project dependencies
  - Create `functions/src/types.ts` with all interfaces: `BusinessRaw`, `HtmlSignals`, `ScorerInput`, `ScoredBusiness`, `BusinessLabel`, `SearchResponse`
  - Add `fast-check` to `functions/package.json` devDependencies
  - _Requirements: 9.3, 7.1_

- [x] 2. Implement the Scorer module
  - [x] 2.1 Create `functions/src/scorer.ts` with the `score(input: ScorerInput)` pure function
    - Implement all penalty rules from R7 (no HTTPS +30, no meta +20, no favicon +10, deprecated tags +15, old copyright +10, low word count +10, Lighthouse performance penalty, Lighthouse SEO penalty, domain age +10, ad pixel −10, agency footer −15)
    - Clamp result to [0, 100]
    - Assign label: score ≥ 60 → `"opportunity"`, score < 60 → `"low opportunity"`
    - Handle null HTML signals, null Lighthouse scores, null domain age as 0 penalty contribution
    - _Requirements: 7.1–7.17, 9.5, 9.6_

  - [ ]* 2.2 Write property test for scorer penalty sum (Property 11)
    - **Property 11: Scorer applies correct penalties**
    - **Validates: Requirements 7.2–7.17**
    - Use `fast-check` to generate arbitrary `ScorerInput` objects and verify the raw penalty sum matches the expected formula before clamping
    - `// Feature: dataforseo-business-search, Property 11: Scorer applies correct penalties`

  - [ ]* 2.3 Write property test for score clamping (Property 12)
    - **Property 12: Score is always clamped to [0, 100]**
    - **Validates: Requirements 7.14**
    - Generate arbitrary `ScorerInput` and assert `0 <= score <= 100`
    - `// Feature: dataforseo-business-search, Property 12: Score is always clamped to [0, 100]`

  - [ ]* 2.4 Write property test for label assignment (Property 13)
    - **Property 13: Label assignment is consistent with score**
    - **Validates: Requirements 9.5, 9.6**
    - Generate arbitrary `ScorerInput`, assert label is `"opportunity"` iff score ≥ 60
    - `// Feature: dataforseo-business-search, Property 13: Label assignment is consistent with score`

  - [ ]* 2.5 Write property test for no-website scoring (Property 14)
    - **Property 14: No-website businesses score 100 with correct label**
    - **Validates: Requirements 8.1**
    - Generate arbitrary `ScorerInput` with null website, assert `{ score: 100, label: "no website" }`
    - `// Feature: dataforseo-business-search, Property 14: No-website businesses always score 100`

- [x] 3. Checkpoint — Ensure scorer tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement the RDAP client
  - [x] 4.1 Create `functions/src/rdap.ts` with `lookupDomainAge(domain: string): Promise<number | null>`
    - Implement TLD-based endpoint selection: `.com` → verisign/com, `.net` → verisign/net, all others → iana
    - Parse `events` array for `eventAction === "registration"`, compute age in years from current date
    - Return null on any fetch error or missing registration date
    - _Requirements: 6.1–6.6_

  - [ ]* 4.2 Write property test for RDAP endpoint selection (Property 9)
    - **Property 9: RDAP endpoint selected correctly by TLD**
    - **Validates: Requirements 6.2, 6.3, 6.4**
    - Generate arbitrary domain strings with `.com`, `.net`, and other TLDs; assert correct URL is constructed
    - `// Feature: dataforseo-business-search, Property 9: RDAP endpoint selection by TLD`

  - [ ]* 4.3 Write property test for domain age computation (Property 10)
    - **Property 10: Domain age is non-negative and computed correctly**
    - **Validates: Requirements 6.5**
    - Generate arbitrary past registration dates, assert computed age equals `floor((now - date) / msPerYear)` and is non-negative
    - `// Feature: dataforseo-business-search, Property 10: Domain age computation`

- [x] 5. Implement the DataForSEO API client
  - [x] 5.1 Create `functions/src/dfsClient.ts` with `searchBusinesses`, `fetchInstantPages`, and `fetchLighthouse`
    - `searchBusinesses`: POST to `/business_data/business_listings/search/live`, parse `tasks[0].result[0].items` into `BusinessRaw[]`
    - `fetchInstantPages`: POST each URL to `/on_page/instant_pages` with the `custom_js` snippet; use `Promise.allSettled` in batches of 25; extract `HtmlSignals` per response including ad pixel detection and agency footer regex matching; return null for failed requests
    - `fetchLighthouse`: POST each URL to `/on_page/lighthouse/live/json` with mobile emulation and `performance`+`seo` categories; use `Promise.allSettled` for a single batch of up to 25; extract scores as 0–1 values; return null for failed requests
    - _Requirements: 2.1–2.3, 3.1–3.5, 5.1–5.5_

  - [ ]* 5.2 Write property test for Basic Auth construction (Property 2)
    - **Property 2: Basic Auth header construction**
    - **Validates: Requirements 2.2**
    - Generate arbitrary email/password strings, assert header equals `"Basic " + Buffer.from(email + ":" + password).toString("base64")`
    - `// Feature: dataforseo-business-search, Property 2: Basic Auth header construction`

  - [ ]* 5.3 Write property test for HTML signal extraction (Property 3)
    - **Property 3: HTML signal extraction from Instant Pages response**
    - **Validates: Requirements 3.3, 3.4**
    - Generate arbitrary Instant Pages response shapes, assert each extracted `HtmlSignals` field matches the corresponding response value
    - `// Feature: dataforseo-business-search, Property 3: HTML signal extraction`

  - [ ]* 5.4 Write property test for custom_js footer extraction (Property 4)
    - **Property 4: custom_js footer extraction**
    - **Validates: Requirements 3.2**
    - Generate arbitrary body text strings, assert `footerText` equals last 500 chars and `copyrightYear` is the first year match in that footer (or null)
    - `// Feature: dataforseo-business-search, Property 4: custom_js footer extraction`

  - [ ]* 5.5 Write property test for Lighthouse score range (Property 8)
    - **Property 8: Lighthouse scores extracted as 0–1 values**
    - **Validates: Requirements 5.4**
    - Generate arbitrary Lighthouse response objects with scores in [0, 1], assert extracted values remain in [0, 1]
    - `// Feature: dataforseo-business-search, Property 8: Lighthouse scores in [0, 1]`

  - [ ]* 5.6 Write property test for Lighthouse URL cap (Property 7)
    - **Property 7: Lighthouse receives at most 25 URLs**
    - **Validates: Requirements 5.1, 5.2**
    - Generate lists of non-parked businesses of length > 25, assert `fetchLighthouse` is called with at most 25 URLs and businesses beyond position 25 have null Lighthouse scores
    - `// Feature: dataforseo-business-search, Property 7: Lighthouse cap at 25`

- [x] 6. Checkpoint — Ensure all client tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement the HTTP handler and pipeline orchestration
  - [x] 7.1 Add `dataforseoBusinessSearch` HTTP function to `functions/src/index.ts`
    - Validate request method (405 for non-POST) and body fields (400 for missing keyword/location)
    - Check `DFS_EMAIL` and `DFS_PASSWORD` env vars (500 if missing)
    - Set Firebase function timeout to 300 seconds via `runWith({ timeoutSeconds: 300 })`
    - Wire the pipeline: `searchBusinesses` → pre-flight filter → split no-website/has-website → `fetchInstantPages` → parked classification → `fetchLighthouse` (first 25) + `lookupDomainAge` (all non-parked, parallel) → `score()` per business → sort → respond
    - Wrap pipeline in `Promise.race` against a 290-second timeout; return `{ results, timedOut: true }` if timeout fires
    - Include CORS headers on all responses
    - _Requirements: 1.1–1.5, 2.4–2.6, 4.1–4.3, 8.1–8.3, 9.1–9.7, 10.1–10.3, 11.1–11.2_

  - [ ]* 7.2 Write property test for pre-flight filter (Property 1)
    - **Property 1: Pre-flight filter removes permanently_closed and Facebook URL businesses**
    - **Validates: Requirements 2.4, 2.5**
    - Generate arbitrary `BusinessRaw[]` arrays with mixed permanently_closed flags and Facebook/non-Facebook URLs; assert no permanently_closed or Facebook-URL business appears in filter output
    - `// Feature: dataforseo-business-search, Property 1: Pre-flight filter`

  - [ ]* 7.3 Write property test for parked classification in pipeline (Property 5 & 6)
    - **Property 5: Parked domain classification**
    - **Property 6: Parked businesses have null score and "parked" label**
    - **Validates: Requirements 4.1, 4.3**
    - Generate arbitrary `HtmlSignals` objects; assert `isParked` returns true iff `wordCount < 100` OR footer contains a parking keyword; assert parked businesses in pipeline output have `score: null` and `label: "parked"`
    - `// Feature: dataforseo-business-search, Property 5 & 6: Parked classification`

  - [ ]* 7.4 Write property test for response sort order (Property 15)
    - **Property 15: Response sorted descending by score, nulls last**
    - **Validates: Requirements 9.2**
    - Generate arbitrary arrays of `ScoredBusiness` objects with mixed scores and nulls; assert sorted output has all non-null scores in non-increasing order followed by all null-score entries
    - `// Feature: dataforseo-business-search, Property 15: Response sort order`

  - [ ]* 7.5 Write property test for response object completeness (Property 16)
    - **Property 16: Every response business object contains all required fields**
    - **Validates: Requirements 9.3**
    - Generate arbitrary pipeline inputs and run through the full scoring/mapping step; assert every output object has all required fields present (not undefined)
    - `// Feature: dataforseo-business-search, Property 16: Response object completeness`

  - [ ]* 7.6 Write unit tests for HTTP handler error cases
    - Test: missing `keyword` → 400
    - Test: missing `location` → 400
    - Test: GET request → 405
    - Test: missing `DFS_EMAIL` → 500
    - Test: DFS business search throws → 502
    - _Requirements: 1.3, 1.4, 2.6, 11.2_

- [x] 8. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- The Scorer (`scorer.ts`) must remain a pure function with no imports from Firebase or DFS modules
- Lighthouse is capped at 25 URLs (single batch) — do not loop batches
- Lighthouse scores must stay as 0–1 floats throughout; only convert for display if needed
- RDAP `.net` endpoint is `rdap.verisign.com/net/v1/domain/` — not the same path as `.com`
- The `custom_js` snippet uses `substring(Math.max(0, bodyText.length - 500))` to get the last 500 chars
- Copyright year threshold is 2 years (not 5 — the reference code had a bug here)

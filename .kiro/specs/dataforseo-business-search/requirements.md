# Requirements Document

## Introduction

A Firebase HTTP Cloud Function that accepts a keyword and location, discovers local businesses via the DataForSEO Business Listings API, evaluates each business's web presence quality using HTML signals, Lighthouse scores, and domain age, then returns a scored and sorted list of businesses. A higher score indicates a weaker web presence and therefore a better sales opportunity.

The function is designed for synchronous HTTP responses. Given that Lighthouse analysis can take 15–40 seconds per site, the function caps Lighthouse to a single batch of at most 25 sites (the first 25 non-parked businesses). Sites beyond that cap receive null Lighthouse scores and are scored on HTML signals and domain age alone. The Firebase function timeout is set to 300 seconds.

The opportunity scoring logic is isolated in a dedicated module so it can be adjusted independently of the API orchestration.

## Glossary

- **Function**: The Firebase HTTP Cloud Function being implemented (`dataforseoBusinessSearch`)
- **Business**: A local business record returned by the DataForSEO Business Listings API
- **Web_Presence_Score**: An integer 0–100 representing how poor a business's web presence is; higher = better sales opportunity (starts at 0, penalty points added for weaknesses)
- **HTML_Signals**: Data extracted from a business's website via DataForSEO's `on_page/instant_pages` endpoint, including word count, meta description, favicon, HTTPS status, deprecated tags, copyright year, footer text, ad pixel presence, and agency footer presence
- **Lighthouse_Score**: Performance and SEO scores (0–1 range) returned by DataForSEO's `on_page/lighthouse/live/json` endpoint
- **Domain_Age**: The age in years of a business's registered domain, determined via RDAP lookup
- **Parked_Domain**: A domain whose page has fewer than 100 words or whose footer contains parking-related keywords
- **Agency_Footer**: Footer text matching patterns that indicate the site is managed by a web agency
- **Ad_Pixel**: A tracking script from a known advertising platform (Google Ads, Meta Pixel, etc.) detected in the page's script URLs
- **RDAP**: Registration Data Access Protocol — a free public API used to look up domain registration dates
- **DFS**: DataForSEO — the third-party API provider
- **Scorer**: The isolated module responsible for computing Web_Presence_Score from collected signals

## Requirements

### Requirement 1: HTTP Endpoint

**User Story:** As a developer, I want to call the function over HTTP with a keyword and location, so that I can trigger a business search from Postman or any HTTP client.

#### Acceptance Criteria

1. THE Function SHALL expose an HTTP POST endpoint accessible without authentication.
2. WHEN a POST request is received with a JSON body containing `keyword` (string) and `location` (string), THE Function SHALL begin processing the request.
3. IF the request body is missing `keyword` or `location`, THEN THE Function SHALL return HTTP 400 with a JSON error message describing the missing field.
4. IF the request method is not POST, THEN THE Function SHALL return HTTP 405.
5. THE Function SHALL include CORS headers to allow cross-origin requests.

---

### Requirement 2: Business Discovery

**User Story:** As a developer, I want the function to discover local businesses matching the keyword and location, so that I have a candidate list to evaluate.

#### Acceptance Criteria

1. WHEN processing a valid request, THE Function SHALL POST to the DataForSEO `/business_data/business_listings/search/live` endpoint with the provided `keyword` and `location`.
2. THE Function SHALL authenticate with DataForSEO using HTTP Basic Auth constructed from the `DFS_EMAIL` and `DFS_PASSWORD` environment variables as `Buffer.from("email:password").toString("base64")`.
3. THE Function SHALL request up to 50 business results per search.
4. WHEN the DataForSEO business search response is received, THE Function SHALL filter out any businesses marked as `permanently_closed`.
5. WHEN the DataForSEO business search response is received, THE Function SHALL filter out any businesses whose website is a Facebook URL.
6. IF the DataForSEO business search request fails, THEN THE Function SHALL return HTTP 502 with a JSON error message.

---

### Requirement 3: HTML Signal Extraction

**User Story:** As a developer, I want the function to extract HTML signals from each business's website, so that I can evaluate web presence quality without a full browser crawl.

#### Acceptance Criteria

1. WHEN a filtered list of businesses with websites is available, THE Function SHALL POST to the DataForSEO `/on_page/instant_pages` endpoint for each business website in batches of at most 25 concurrent requests using `Promise.allSettled`.
2. THE `on_page/instant_pages` request SHALL include a `custom_js` snippet that extracts the last 500 characters of the page body text (to capture footer content) and the copyright year from that text.
3. WHEN the `on_page/instant_pages` response is received for a business, THE Function SHALL extract: word count, meta description presence, favicon presence, HTTPS status, deprecated HTML tag count, copyright year, footer text (last 500 chars), script URLs, and whether any script URL matches a known ad pixel domain.
4. WHEN the `on_page/instant_pages` response is received for a business, THE Function SHALL determine whether the footer text matches agency footer patterns (regex on known agency phrases).
5. IF the `on_page/instant_pages` request for a business fails or times out, THEN THE Function SHALL record null HTML signals for that business and continue processing.

---

### Requirement 4: Parked Domain Filtering

**User Story:** As a developer, I want parked or unreachable domains excluded before running Lighthouse, so that I avoid wasting API quota on non-functional sites.

#### Acceptance Criteria

1. WHEN HTML signals have been collected for a business, THE Function SHALL classify the domain as parked IF the page word count is less than 100 OR the footer text contains parking-related keywords (e.g., "buy this domain", "domain for sale", "parked").
2. WHEN a domain is classified as parked, THE Function SHALL exclude the business from Lighthouse and RDAP processing.
3. WHEN a domain is classified as parked, THE Function SHALL include the business in the final response with a null score and label `"parked"`.

---

### Requirement 5: Lighthouse Scoring

**User Story:** As a developer, I want Lighthouse performance and SEO scores for each non-parked business website, so that I can factor page quality into the opportunity score.

#### Acceptance Criteria

1. WHEN non-parked business websites are identified, THE Function SHALL POST to the DataForSEO `/on_page/lighthouse/live/json` endpoint for the first 25 non-parked businesses only, as a single concurrent batch using `Promise.allSettled`.
2. Non-parked businesses beyond the first 25 SHALL receive null Lighthouse scores and be scored on HTML signals and domain age alone.
3. THE Lighthouse request SHALL target mobile device emulation and request the `performance` and `seo` categories.
4. WHEN the Lighthouse response is received, THE Function SHALL extract the numeric scores in the 0–1 range for `performance` and `seo` (raw fractional values, not converted to 0–100).
5. IF the Lighthouse request for a business fails, THEN THE Function SHALL record null Lighthouse scores for that business and continue processing.

---

### Requirement 6: Domain Age Lookup

**User Story:** As a developer, I want the domain registration age for each business website, so that I can penalize newly registered domains in the opportunity score.

#### Acceptance Criteria

1. WHEN non-parked business websites are identified, THE Function SHALL perform an RDAP lookup for each domain in parallel with Lighthouse processing using `Promise.allSettled`.
2. FOR `.com` domains, THE Function SHALL query `https://rdap.verisign.com/com/v1/domain/{domain}`.
3. FOR `.net` domains, THE Function SHALL query `https://rdap.verisign.com/net/v1/domain/{domain}`.
4. FOR all other TLDs, THE Function SHALL query `https://rdap.iana.org/domain/{domain}`.
5. WHEN the RDAP response is received, THE Function SHALL parse the `registration` event date and compute domain age in years from the current date.
6. IF the RDAP lookup fails or returns no registration date, THEN THE Function SHALL record null domain age for that business and continue processing.

---

### Requirement 7: Opportunity Scoring

**User Story:** As a developer, I want each business assigned a numeric opportunity score, so that I can rank businesses by how likely they are to need web services.

#### Acceptance Criteria

1. THE Scorer SHALL be implemented as a standalone function or module, separate from the HTTP handler and API orchestration logic, accepting a signals object and returning a score and label.
2. WHEN all signals have been collected for a business with a website, THE Scorer SHALL compute a Web_Presence_Score starting at 0 and adding penalty points for each weakness found.
3. THE Scorer SHALL add 30 points IF the website does not use HTTPS.
4. THE Scorer SHALL add 20 points IF the page has no meta description.
5. THE Scorer SHALL add 10 points IF the page has no favicon.
6. THE Scorer SHALL add 15 points IF the page contains deprecated HTML tags (count > 0).
7. THE Scorer SHALL add 10 points IF the copyright year in the footer is more than 2 years before the current year.
8. THE Scorer SHALL add 10 points IF the page word count is less than 300.
9. THE Scorer SHALL add up to 20 points based on the Lighthouse performance score using the formula: `Math.floor((1 - performance_score) * 20)`, where `performance_score` is in the 0–1 range.
10. THE Scorer SHALL add up to 15 points based on the Lighthouse SEO score using the formula: `Math.floor((1 - seo_score) * 15)`, where `seo_score` is in the 0–1 range.
11. THE Scorer SHALL add 10 points IF the domain age is less than 2 years.
12. THE Scorer SHALL subtract 10 points IF Ad_Pixels are detected on the page.
13. THE Scorer SHALL subtract 15 points IF an Agency_Footer is detected on the page.
14. THE Scorer SHALL clamp the final Web_Presence_Score to the range 0–100.
15. WHEN Lighthouse scores are null, THE Scorer SHALL treat the missing scores as contributing 0 penalty points.
16. WHEN domain age is null, THE Scorer SHALL treat the missing age as contributing 0 penalty points.
17. WHEN HTML signals are null (Instant Pages request failed), THE Scorer SHALL treat all HTML-signal-based penalties as contributing 0 penalty points for that business.

---

### Requirement 8: No-Website Handling

**User Story:** As a developer, I want businesses with no website to receive the highest opportunity score, so that they appear at the top of the results as the best leads.

#### Acceptance Criteria

1. WHEN a business has no website listed in the DataForSEO response, THE Function SHALL assign a Web_Presence_Score of 100 and a label of `"no website"`.
2. WHEN a business has no website, THE Function SHALL skip all HTML signal, Lighthouse, and RDAP processing for that business.
3. THE Function SHALL NOT filter out no-website businesses during the pre-flight filter in Requirement 2; they SHALL be retained and scored per this requirement.

---

### Requirement 9: Response Format

**User Story:** As a developer, I want the function to return a sorted JSON array of scored businesses, so that I can display or process the results immediately.

#### Acceptance Criteria

1. WHEN all businesses have been scored, THE Function SHALL return HTTP 200 with a JSON response body.
2. THE response body SHALL be an array of business objects sorted in descending order by Web_Presence_Score (highest score first), with null-score businesses appended at the end.
3. EACH business object in the response SHALL include: `name`, `address`, `phone`, `website`, `rating`, `reviewCount`, `category`, `score` (integer or null), and `label` (string).
4. THE `label` field SHALL be one of: `"no website"`, `"parked"`, `"opportunity"`, or `"low opportunity"`.
5. WHEN the score is 60 or above, THE Scorer SHALL assign the label `"opportunity"`.
6. WHEN the score is below 60 and not null, THE Scorer SHALL assign the label `"low opportunity"`.

---

### Requirement 10: Timeout and Execution Limits

**User Story:** As a developer, I want the function to complete within a predictable time window, so that it does not hang indefinitely or exceed Firebase's execution limits.

#### Acceptance Criteria

1. THE Function SHALL be configured with a Firebase function timeout of 300 seconds.
2. WHEN the function completes all processing within the timeout, THE Function SHALL return the full scored results normally.
3. IF the function has not completed processing before the timeout fires, THE Function SHALL return whatever scored results have been computed at that point with HTTP 200, including a `timedOut: true` flag in the response body.

---

### Requirement 11: Configuration and Environment

**User Story:** As a developer, I want credentials and configuration managed via environment variables, so that secrets are not hardcoded in source.

#### Acceptance Criteria

1. THE Function SHALL read `DFS_EMAIL` and `DFS_PASSWORD` from the Firebase Functions environment (`.env` file in the `functions/` directory).
2. IF `DFS_EMAIL` or `DFS_PASSWORD` is not set at runtime, THEN THE Function SHALL return HTTP 500 with a JSON error message indicating missing configuration.
3. THE Function SHALL be defined in `functions/src/index.ts` alongside existing functions.
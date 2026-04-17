import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { sortByScoreDesc, deriveProgressDisplay, type JobStatus, type SearchJobProgress } from "./useSearchJob";
import type { Business, WebsiteAnalysis } from "@/data/mockBusinesses";

// ─── Arbitrary: minimal Business with a leadScore ─────────────────────────────

const arbAnalysis: fc.Arbitrary<WebsiteAnalysis> = fc.record({
  hasWebsite: fc.boolean(),
  designScore: fc.integer({ min: 0, max: 100 }),
  mobileFriendly: fc.boolean(),
  hasHttps: fc.boolean(),
  deprecatedHtmlTags: fc.integer({ min: 0, max: 50 }),
  websiteAge: fc.integer({ min: 0, max: 30 }),
  copyrightYear: fc.option(fc.integer({ min: 2000, max: 2026 }), { nil: null }),
  loadTimeMs: fc.integer({ min: 0, max: 30000 }),
  isParkedDomain: fc.boolean(),
  isExpiredDomain: fc.boolean(),
  facebookAsWebsite: fc.boolean(),
  hasOnlineAds: fc.boolean(),
  hasMarketingAgency: fc.boolean(),
  seoScore: fc.integer({ min: 0, max: 100 }),
  recentGoogleReviews: fc.boolean(),
  facebookActive: fc.boolean(),
  websiteUrl: fc.option(fc.webUrl(), { nil: null }),
});

const arbBusiness: fc.Arbitrary<Business> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  category: fc.string({ minLength: 1, maxLength: 30 }),
  address: fc.string(),
  city: fc.string(),
  state: fc.string({ minLength: 2, maxLength: 2 }),
  zip: fc.stringMatching(/^\d{5}$/),
  phone: fc.string(),
  googleRating: fc.double({ min: 0, max: 5, noNaN: true }),
  reviewCount: fc.integer({ min: 0, max: 10000 }),
  analysis: arbAnalysis,
  leadScore: fc.oneof(
    fc.integer({ min: 0, max: 100 }),
    fc.constant(null as unknown as number),
  ),
});

// ─── Property 14: Results sorted by score descending ──────────────────────────

describe("Feature: async-search-jobs, Property 14: Results sorted by score descending", () => {
  /**
   * **Validates: Requirements 5.3**
   *
   * For any set of results, after sorting:
   * - All non-null scores appear before all null scores
   * - Non-null scores are in descending order
   */
  it("should sort results by score descending with null scores last", () => {
    fc.assert(
      fc.property(
        fc.array(arbBusiness, { minLength: 0, maxLength: 50 }),
        (businesses) => {
          const sorted = sortByScoreDesc(businesses);

          // Same length (no items lost)
          expect(sorted.length).toBe(businesses.length);

          // Check ordering
          for (let i = 1; i < sorted.length; i++) {
            const prev = sorted[i - 1].leadScore;
            const curr = sorted[i].leadScore;

            if (prev == null) {
              // If previous is null, current must also be null
              expect(curr).toBeNull();
            } else if (curr != null) {
              // Both non-null: descending
              expect(prev).toBeGreaterThanOrEqual(curr);
            }
            // prev non-null, curr null is fine (null goes last)
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── Property 15: Progress display state machine ──────────────────────────────

describe("Feature: async-search-jobs, Property 15: Progress display state machine", () => {
  /**
   * **Validates: Requirements 5.2**
   *
   * For any (status, progress) combination:
   * - running + null/undefined total → generic-loading
   * - running + total 0 (DFS count not yet known) → generic-loading
   * - running + total > 0 → analyzing with correct values
   * - completed + total 0 → no-results
   * - completed + total > 0 → completed
   * - failed → failed
   * - cancelled → cancelled
   */
  const arbProgress: fc.Arbitrary<SearchJobProgress | null> = fc.oneof(
    fc.constant(null),
    fc.record({
      analyzed: fc.integer({ min: 0, max: 500 }),
      total: fc.integer({ min: 0, max: 500 }),
    }),
  );

  const arbStatus: fc.Arbitrary<JobStatus> = fc.constantFrom(
    "idle", "creating", "running", "completed", "failed", "cancelled",
  );

  it("should derive correct display state for all status/progress combinations", () => {
    fc.assert(
      fc.property(arbStatus, arbProgress, (status, progress) => {
        const result = deriveProgressDisplay(status, progress);

        switch (status) {
          case "idle":
          case "creating":
            expect(result.kind).toBe("idle");
            break;

          case "failed":
            expect(result.kind).toBe("failed");
            break;

          case "cancelled":
            expect(result.kind).toBe("cancelled");
            break;

          case "running":
            if (progress == null || progress.total === 0) {
              expect(result.kind).toBe("generic-loading");
            } else {
              expect(result.kind).toBe("analyzing");
              if (result.kind === "analyzing") {
                expect(result.analyzed).toBe(progress.analyzed);
                expect(result.total).toBe(progress.total);
              }
            }
            break;

          case "completed":
            if (progress != null && progress.total === 0) {
              expect(result.kind).toBe("no-results");
            } else {
              expect(result.kind).toBe("completed");
            }
            break;
        }
      }),
      { numRuns: 100 },
    );
  });
});

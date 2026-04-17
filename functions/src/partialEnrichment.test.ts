import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { score, computeLegitimacy } from "./scorer";
import { ScoredBusiness, BusinessRaw, ScorerInput, HtmlSignals } from "./types";
import { extractBusinessData } from "./dfsClient";

/**
 * Feature: async-search-jobs
 * Property 8: Partial enrichment failure produces null values, not aborts
 * Validates: Requirements 3.7
 *
 * For any set of businesses where some individual enrichment steps fail
 * (RDAP timeout, Lighthouse failure), the pipeline SHALL still produce
 * scored results for those businesses with null values for the failed
 * enrichment fields, and the total result count SHALL equal the total
 * business count (no businesses are dropped).
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildScorerInput(
  b: BusinessRaw,
  overrides: {
    website?: string | null;
    htmlSignals?: ScorerInput["htmlSignals"];
    lighthousePerformance?: number | null;
    lighthouseSeo?: number | null;
    domainAgeYears?: number | null;
    isExpiredDomain?: boolean;
  } = {}
): ScorerInput {
  const socialTypes = ["facebook", "instagram", "twitter", "linkedin", "youtube", "pinterest", "tiktok"];
  const contacts = b.contact_info ?? [];
  const socialContacts = contacts.filter((c) => socialTypes.includes(c.type));
  const timetable = b.work_time?.work_hours?.timetable;
  const hasBusinessHours = !!(timetable && Object.keys(timetable).length > 0);

  return {
    website: overrides.website ?? b.url ?? null,
    htmlSignals: overrides.htmlSignals ?? null,
    lighthousePerformance: overrides.lighthousePerformance ?? null,
    lighthouseSeo: overrides.lighthouseSeo ?? null,
    domainAgeYears: overrides.domainAgeYears ?? null,
    isExpiredDomain: overrides.isExpiredDomain ?? false,
    phone: b.phone,
    isClaimed: b.is_claimed,
    currentStatus: b.work_time?.work_hours?.current_status ?? null,
    permanentlyClosed: b.permanently_closed,
    reviewCount: b.rating?.votes_count ?? null,
    rating: b.rating?.value ?? null,
    ratingDistribution: b.rating_distribution,
    firstSeen: b.first_seen,
    totalPhotos: b.total_photos,
    hasFacebookLink: socialContacts.some((c) => c.type === "facebook"),
    socialLinkCount: socialContacts.length,
    hasLogo: !!b.logo,
    hasMainImage: !!b.main_image,
    hasAttributes: !!(b.attributes?.available_attributes && Object.keys(b.attributes.available_attributes).length > 0),
    hasDescription: !!b.description,
    hasBusinessHours,
    address: b.address,
    daysSinceLastReview: null,
    hasOwnerResponses: false,
    hasPeopleAlsoSearch: !!(b.people_also_search && b.people_also_search.length > 0),
    hasPlaceTopics: !!(b.place_topics && Object.keys(b.place_topics).length > 0),
  };
}

/** Replicates the pipeline's scoring with partial enrichment data. */
function scoreBusiness(
  b: BusinessRaw,
  htmlSignals: HtmlSignals | null,
  lighthousePerformance: number | null,
  lighthouseSeo: number | null,
  domainAgeYears: number | null,
  isExpiredDomain: boolean
): ScoredBusiness {
  const input = buildScorerInput(b, {
    website: b.url,
    htmlSignals,
    lighthousePerformance,
    lighthouseSeo,
    domainAgeYears,
    isExpiredDomain,
  });
  const { score: s, label, scoring } = score(input);
  const { legitimacyScore, legitimacyBreakdown } = computeLegitimacy(input);
  return {
    cid: b.cid,
    name: b.title,
    address: b.address,
    phone: b.phone,
    website: b.url,
    rating: b.rating?.value ?? null,
    reviewCount: b.rating?.votes_count ?? null,
    category: b.category,
    score: s,
    label,
    scoring,
    legitimacyScore,
    legitimacyBreakdown,
    businessData: extractBusinessData(b),
    websiteData: htmlSignals,
  };
}

// ── Generators ────────────────────────────────────────────────────────────────

const businessRawArb: fc.Arbitrary<BusinessRaw> = fc.record({
  cid: fc.string({ minLength: 5, maxLength: 20 }),
  title: fc.string({ minLength: 1, maxLength: 50 }),
  address: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: null }),
  phone: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
  url: fc.webUrl(),
  domain: fc.domain(),
  category: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: null }),
  is_claimed: fc.boolean(),
  permanently_closed: fc.constant(false),
  rating: fc.option(
    fc.record({
      value: fc.option(fc.double({ min: 1, max: 5, noNaN: true }), { nil: null }),
      votes_count: fc.option(fc.integer({ min: 0, max: 500 }), { nil: null }),
    }),
    { nil: null }
  ),
}).map((r) => ({
  ...r,
  description: null,
  address_info: null,
  rating_distribution: null,
  category_ids: null,
  additional_categories: null,
  price_level: null,
  total_photos: null,
  attributes: null,
  work_time: null,
  contact_info: null,
  people_also_search: null,
  place_topics: null,
  logo: null,
  main_image: null,
  last_updated_time: null,
  first_seen: null,
  check_url: null,
  feature_id: null,
  place_id: null,
  latitude: null,
  longitude: null,
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Property 8: Partial enrichment failure produces null values, not aborts", () => {
  it("no businesses are dropped when enrichment steps fail", () => {
    fc.assert(
      fc.property(
        fc.array(businessRawArb, { minLength: 1, maxLength: 15 }),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 15 }), // lighthouse fails
        fc.array(fc.boolean(), { minLength: 1, maxLength: 15 }), // RDAP fails
        (businesses, lhFailsRaw, rdapFailsRaw) => {
          const results: ScoredBusiness[] = [];

          for (let i = 0; i < businesses.length; i++) {
            const b = businesses[i];
            const lhFail = lhFailsRaw[i % lhFailsRaw.length];
            const rdapFail = rdapFailsRaw[i % rdapFailsRaw.length];

            const lhPerf = lhFail ? null : 0.85;
            const lhSeo = lhFail ? null : 0.9;
            const domainAge = rdapFail ? null : 5;

            const scored = scoreBusiness(b, null, lhPerf, lhSeo, domainAge, false);
            results.push(scored);
          }

          // Total result count SHALL equal total business count
          expect(results.length).toBe(businesses.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("failed enrichment fields are null in the scored result", () => {
    fc.assert(
      fc.property(
        businessRawArb,
        fc.boolean(), // lighthouse fails
        fc.boolean(), // RDAP fails
        (business, lhFails, rdapFails) => {
          const lhPerf = lhFails ? null : 0.85;
          const lhSeo = lhFails ? null : 0.9;
          const domainAge = rdapFails ? null : 5;

          const result = scoreBusiness(business, null, lhPerf, lhSeo, domainAge, false);

          // Result must exist (not dropped)
          expect(result).toBeDefined();
          expect(result.cid).toBe(business.cid);

          // When lighthouse fails, scoring should have null lighthouse values
          if (lhFails) {
            expect(result.scoring?.lighthousePerformance).toBeNull();
            expect(result.scoring?.lighthouseSeo).toBeNull();
          }

          // When RDAP fails, scoring should have null domain age
          if (rdapFails) {
            expect(result.scoring?.domainAgeYears).toBeNull();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("all businesses produce a valid score or null label regardless of enrichment failures", () => {
    fc.assert(
      fc.property(
        businessRawArb,
        fc.boolean(),
        fc.boolean(),
        (business, lhFails, rdapFails) => {
          const result = scoreBusiness(
            business,
            null,
            lhFails ? null : 0.7,
            lhFails ? null : 0.8,
            rdapFails ? null : 3,
            false
          );

          // Score is either a number (0-100) or null (for disqualified/defunct)
          if (result.score !== null) {
            expect(result.score).toBeGreaterThanOrEqual(0);
            expect(result.score).toBeLessThanOrEqual(100);
          }

          // Label must be one of the valid labels
          const validLabels = [
            "no website", "parked", "dead site", "defunct",
            "disqualified", "third-party listing", "opportunity", "low opportunity",
          ];
          expect(validLabels).toContain(result.label);
        }
      ),
      { numRuns: 100 }
    );
  });
});

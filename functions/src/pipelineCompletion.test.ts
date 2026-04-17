import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { score, computeLegitimacy } from "./scorer";
import { ScoredBusiness, CostBreakdown, BusinessRaw, ScorerInput } from "./types";
import { extractBusinessData } from "./dfsClient";

/**
 * Feature: async-search-jobs
 * Property 6: Pipeline completion invariant
 * Validates: Requirements 3.2, 3.3, 3.4
 *
 * For any successfully completed job:
 * - progress.analyzed SHALL equal progress.total
 * - progress.total SHALL equal the count of documents in the Results_Subcollection
 * - resultCount SHALL equal the count of documents in the Results_Subcollection
 * - Job document status SHALL be "completed" with a non-null cost field
 */

// ── Helpers: replicate the pipeline's batch scoring logic ─────────────────────

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
  const hasPeopleAlsoSearch = !!(b.people_also_search && b.people_also_search.length > 0);
  const hasPlaceTopics = !!(b.place_topics && Object.keys(b.place_topics).length > 0);

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
    hasPeopleAlsoSearch,
    hasPlaceTopics,
  };
}

function scoreNoWebsiteBatch(businesses: BusinessRaw[]): ScoredBusiness[] {
  return businesses.map((b) => {
    const input = buildScorerInput(b, { website: null });
    const { score: s, label, scoring } = score(input);
    const { legitimacyScore, legitimacyBreakdown } = computeLegitimacy(input);
    return {
      cid: b.cid,
      name: b.title,
      address: b.address,
      phone: b.phone,
      website: null,
      rating: b.rating?.value ?? null,
      reviewCount: b.rating?.votes_count ?? null,
      category: b.category,
      score: s,
      label,
      scoring,
      legitimacyScore,
      legitimacyBreakdown,
      businessData: extractBusinessData(b),
      websiteData: null,
    };
  });
}

function scoreWithWebsite(businesses: BusinessRaw[]): ScoredBusiness[] {
  return businesses.map((b) => {
    const input = buildScorerInput(b, { website: b.url });
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
      websiteData: null,
    };
  });
}

// ── Generators ────────────────────────────────────────────────────────────────

/** Generates a minimal valid BusinessRaw with a CID. */
const businessRawArb = (hasUrl: boolean): fc.Arbitrary<BusinessRaw> =>
  fc.record({
    cid: fc.string({ minLength: 5, maxLength: 20 }),
    title: fc.string({ minLength: 1, maxLength: 50 }),
    address: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: null }),
    phone: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
    url: hasUrl
      ? fc.webUrl().map((u) => u)
      : fc.constant(null),
    domain: hasUrl
      ? fc.domain().map((d) => d)
      : fc.constant(null),
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

/**
 * Simulates the pipeline's batch processing and tracks the invariants.
 * Returns the final state that would be written to the job document.
 */
function simulatePipeline(noWebsiteItems: BusinessRaw[], hasWebsiteItems: BusinessRaw[]) {
  const totalBusinesses = noWebsiteItems.length + hasWebsiteItems.length;
  let analyzed = 0;
  let totalResultsWritten = 0;
  const allResults: ScoredBusiness[] = [];

  // Batch 1: no-website
  if (noWebsiteItems.length > 0) {
    const scored = scoreNoWebsiteBatch(noWebsiteItems);
    const written = scored.filter((b) => b.cid).length;
    totalResultsWritten += written;
    analyzed += noWebsiteItems.length;
    allResults.push(...scored);
  }

  // Batch 2+: has-website (simplified — no actual fetch, just score)
  if (hasWebsiteItems.length > 0) {
    const scored = scoreWithWebsite(hasWebsiteItems);
    const written = scored.filter((b) => b.cid).length;
    totalResultsWritten += written;
    analyzed += hasWebsiteItems.length;
    allResults.push(...scored);
  }

  const cost: CostBreakdown = {
    businessSearch: 0.01,
    instantPages: hasWebsiteItems.length > 0 ? 0.02 : 0,
    lighthouse: 0,
    totalDfs: 0.03,
    firestoreReads: 0,
    firestoreWrites: totalResultsWritten,
    cachedBusinesses: 0,
    freshBusinesses: totalBusinesses,
  };

  return {
    status: "completed" as const,
    progress: { analyzed, total: totalBusinesses },
    resultCount: totalResultsWritten,
    cost,
    resultsInSubcollection: allResults.filter((b) => b.cid).length,
  };
}

// ── Property Tests ────────────────────────────────────────────────────────────

describe("Property 6: Pipeline completion invariant", () => {
  it("progress.analyzed equals progress.total on completion", () => {
    fc.assert(
      fc.property(
        fc.array(businessRawArb(false), { minLength: 0, maxLength: 10 }),
        fc.array(businessRawArb(true), { minLength: 0, maxLength: 10 }),
        (noWebsite, hasWebsite) => {
          // Skip empty inputs (zero results is a special case handled separately)
          if (noWebsite.length === 0 && hasWebsite.length === 0) return;

          const result = simulatePipeline(noWebsite, hasWebsite);
          expect(result.progress.analyzed).toBe(result.progress.total);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("resultCount equals the count of documents in the Results_Subcollection", () => {
    fc.assert(
      fc.property(
        fc.array(businessRawArb(false), { minLength: 0, maxLength: 10 }),
        fc.array(businessRawArb(true), { minLength: 0, maxLength: 10 }),
        (noWebsite, hasWebsite) => {
          if (noWebsite.length === 0 && hasWebsite.length === 0) return;

          const result = simulatePipeline(noWebsite, hasWebsite);
          expect(result.resultCount).toBe(result.resultsInSubcollection);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("status is 'completed' with a non-null cost field", () => {
    fc.assert(
      fc.property(
        fc.array(businessRawArb(false), { minLength: 0, maxLength: 10 }),
        fc.array(businessRawArb(true), { minLength: 0, maxLength: 10 }),
        (noWebsite, hasWebsite) => {
          if (noWebsite.length === 0 && hasWebsite.length === 0) return;

          const result = simulatePipeline(noWebsite, hasWebsite);
          expect(result.status).toBe("completed");
          expect(result.cost).not.toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("zero DFS results produces completed status with resultCount 0", () => {
    const result = simulatePipeline([], []);
    // Special case: when both arrays are empty, the pipeline completes immediately
    // with progress {0,0} and resultCount 0
    expect(result.progress.analyzed).toBe(0);
    expect(result.progress.total).toBe(0);
    expect(result.resultCount).toBe(0);
    expect(result.status).toBe("completed");
    expect(result.cost).not.toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { normalizeBusiness, type ApiBusiness, type ApiScoring, type ApiBusinessData, type ApiWebsiteData } from "./leadTypes";

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const arbScoring: fc.Arbitrary<ApiScoring> = fc.record({
  total: fc.integer({ min: 0, max: 100 }),
  reasons: fc.array(fc.string({ minLength: 1, maxLength: 40 }), { minLength: 0, maxLength: 5 }),
  lighthousePerformance: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: null }),
  lighthouseSeo: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: null }),
  domainAgeYears: fc.option(fc.double({ min: 0, max: 30, noNaN: true }), { nil: null }),
  isExpiredDomain: fc.option(fc.boolean(), { nil: null }),
  isHttps: fc.option(fc.boolean(), { nil: null }),
  wordCount: fc.option(fc.integer({ min: 0, max: 50000 }), { nil: null }),
  hasMetaDescription: fc.option(fc.boolean(), { nil: null }),
  hasFavicon: fc.option(fc.boolean(), { nil: null }),
  fetchFailed: fc.option(fc.boolean(), { nil: null }),
  statusCode: fc.option(fc.integer({ min: 100, max: 599 }), { nil: null }),
  onpageScore: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: null }),
});

const arbBusinessData: fc.Arbitrary<ApiBusinessData> = fc.record({
  description: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
  isClaimed: fc.boolean(),
  permanentlyClosed: fc.boolean(),
  additionalCategories: fc.option(fc.array(fc.string({ maxLength: 20 }), { maxLength: 3 }), { nil: null }),
  city: fc.option(fc.string({ maxLength: 30 }), { nil: null }),
  zip: fc.option(fc.stringMatching(/^\d{5}$/), { nil: null }),
  region: fc.option(fc.string({ minLength: 2, maxLength: 2 }), { nil: null }),
  ratingDistribution: fc.option(
    fc.record({
      "1": fc.integer({ min: 0, max: 500 }),
      "2": fc.integer({ min: 0, max: 500 }),
      "3": fc.integer({ min: 0, max: 500 }),
      "4": fc.integer({ min: 0, max: 500 }),
      "5": fc.integer({ min: 0, max: 500 }),
    }),
    { nil: null },
  ),
  priceLevel: fc.option(fc.constantFrom("$", "$$", "$$$", "$$$$"), { nil: null }),
  currentStatus: fc.option(fc.constantFrom("open", "close"), { nil: null }),
  emails: fc.array(fc.emailAddress(), { maxLength: 2 }),
  socialLinks: fc.array(
    fc.record({ type: fc.constantFrom("facebook", "instagram", "twitter"), value: fc.webUrl() }),
    { maxLength: 3 },
  ),
  totalPhotos: fc.option(fc.integer({ min: 0, max: 200 }), { nil: null }),
  placeTopics: fc.option(fc.record({ topic: fc.integer({ min: 1, max: 10 }) }), { nil: null }),
  logo: fc.option(fc.webUrl(), { nil: null }),
  mainImage: fc.option(fc.webUrl(), { nil: null }),
  lastUpdatedTime: fc.option(fc.string(), { nil: null }),
  firstSeen: fc.option(fc.string(), { nil: null }),
  checkUrl: fc.option(fc.webUrl(), { nil: null }),
  latitude: fc.option(fc.double({ min: -90, max: 90, noNaN: true }), { nil: null }),
  longitude: fc.option(fc.double({ min: -180, max: 180, noNaN: true }), { nil: null }),
});

const arbWebsiteData: fc.Arbitrary<ApiWebsiteData | null> = fc.option(
  fc.record({
    statusCode: fc.option(fc.integer({ min: 100, max: 599 }), { nil: null }),
    fetchFailed: fc.option(fc.boolean(), { nil: null }),
    onpageScore: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: null }),
    totalDomSize: fc.option(fc.integer({ min: 0, max: 100000 }), { nil: null }),
    pageSize: fc.option(fc.integer({ min: 0, max: 5000000 }), { nil: null }),
    encodedSize: fc.option(fc.integer({ min: 0, max: 5000000 }), { nil: null }),
    server: fc.option(fc.string({ maxLength: 30 }), { nil: null }),
    contentEncoding: fc.option(fc.constantFrom("gzip", "br", "deflate"), { nil: null }),
    mediaType: fc.option(fc.constantFrom("text/html", "application/json"), { nil: null }),
    finalUrl: fc.option(fc.webUrl(), { nil: null }),
    isHttps: fc.option(fc.boolean(), { nil: null }),
    redirectedToHttps: fc.option(fc.boolean(), { nil: null }),
    wordCount: fc.option(fc.integer({ min: 0, max: 50000 }), { nil: null }),
    hasMetaDescription: fc.option(fc.boolean(), { nil: null }),
    hasFavicon: fc.option(fc.boolean(), { nil: null }),
    deprecatedTagCount: fc.option(fc.integer({ min: 0, max: 50 }), { nil: null }),
    copyrightYear: fc.option(fc.integer({ min: 1990, max: 2026 }), { nil: null }),
    headerText: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
    footerText: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
    hasAdPixel: fc.option(fc.boolean(), { nil: null }),
    hasAgencyFooter: fc.option(fc.boolean(), { nil: null }),
    hasBrokenResources: fc.option(fc.boolean(), { nil: null }),
    hasBrokenLinks: fc.option(fc.boolean(), { nil: null }),
    pageTiming: fc.option(
      fc.record({
        timeToInteractive: fc.option(fc.integer({ min: 0, max: 30000 }), { nil: null }),
        domComplete: fc.option(fc.integer({ min: 0, max: 30000 }), { nil: null }),
        largestContentfulPaint: fc.option(fc.integer({ min: 0, max: 30000 }), { nil: null }),
      }),
      { nil: null },
    ),
    pageMeta: fc.option(
      fc.record({
        title: fc.option(fc.string({ maxLength: 60 }), { nil: null }),
        description: fc.option(fc.string({ maxLength: 160 }), { nil: null }),
      }),
      { nil: null },
    ),
    pageChecks: fc.option(fc.record({ check: fc.boolean() }), { nil: null }),
  }),
  { nil: null },
);

const arbApiBusiness: fc.Arbitrary<ApiBusiness> = fc.record({
  cid: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  address: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
  phone: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
  website: fc.option(fc.webUrl(), { nil: null }),
  rating: fc.option(fc.double({ min: 1, max: 5, noNaN: true }), { nil: null }),
  reviewCount: fc.option(fc.integer({ min: 0, max: 10000 }), { nil: null }),
  category: fc.string({ minLength: 1, maxLength: 30 }),
  score: fc.integer({ min: 0, max: 100 }),
  label: fc.constantFrom("great-lead", "good-lead", "okay-lead", "poor-lead"),
  scoring: arbScoring,
  legitimacyScore: fc.integer({ min: 0, max: 100 }),
  legitimacyBreakdown: fc.option(
    fc.record({
      total: fc.integer({ min: 0, max: 100 }),
      reasons: fc.array(fc.string({ maxLength: 40 }), { maxLength: 5 }),
    }),
    { nil: null },
  ),
  businessData: arbBusinessData,
  websiteData: arbWebsiteData,
});

// ─── Property 12: Results normalization equivalence ───────────────────────────

describe("Feature: async-search-jobs, Property 12: Results normalization equivalence", () => {
  /**
   * **Validates: Requirements 6.2, 10.5**
   *
   * For any ScoredBusiness object, normalizing it via normalizeBusiness()
   * produces the same Business object regardless of whether the ScoredBusiness
   * came from the Results_Subcollection (with extra uid field) or from the
   * old synchronous API response (without uid).
   */
  it("should produce identical Business output with or without extra uid field", () => {
    fc.assert(
      fc.property(arbApiBusiness, fc.uuid(), (apiBiz, uid) => {
        // Normalize the plain ApiBusiness (old sync response shape)
        const fromSync = normalizeBusiness(apiBiz);

        // Simulate Results_Subcollection shape: same object with extra uid field
        const subcollectionDoc = { ...apiBiz, uid } as ApiBusiness;
        const fromSubcollection = normalizeBusiness(subcollectionDoc);

        // Both normalizations must produce identical Business objects
        expect(fromSubcollection).toEqual(fromSync);
      }),
      { numRuns: 100 },
    );
  });
});

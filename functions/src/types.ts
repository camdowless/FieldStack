// ─── Business Listings API (raw from DataForSEO) ──────────────────────────────

import { Timestamp } from "firebase-admin/firestore";
export interface BusinessRaw {
  title: string;
  description: string | null;
  address: string | null;
  address_info: {
    borough: string | null;
    address: string | null;
    city: string | null;
    zip: string | null;
    region: string | null;
    country_code: string | null;
  } | null;
  phone: string | null;
  domain: string | null;
  url: string | null;
  rating: { value: number | null; votes_count: number | null } | null;
  rating_distribution: Record<string, number> | null;
  category: string | null;
  category_ids: string[] | null;
  additional_categories: string[] | null;
  is_claimed: boolean;
  price_level: string | null;
  total_photos: number | null;
  attributes: {
    available_attributes: Record<string, string[]> | null;
    unavailable_attributes: Record<string, string[]> | null;
  } | null;
  work_time: {
    work_hours: {
      timetable: Record<string, unknown> | null;
      current_status: string | null;
    } | null;
  } | null;
  contact_info: Array<{ type: string; value: string; source: string }> | null;
  people_also_search: Array<{
    cid: string;
    title: string;
    rating: { value: number | null; votes_count: number | null } | null;
  }> | null;
  place_topics: Record<string, number> | null;
  logo: string | null;
  main_image: string | null;
  last_updated_time: string | null;
  first_seen: string | null;
  check_url: string | null;
  cid: string | null;
  feature_id: string | null;
  place_id: string | null;
  latitude: number | null;
  longitude: number | null;
}

// ─── Instant Pages signals (extracted from DFS on_page/instant_pages) ─────────

export interface PageTimingData {
  timeToInteractive: number | null;
  domComplete: number | null;
  largestContentfulPaint: number | null;
  firstInputDelay: number | null;
  cumulativeLayoutShift: number | null;
  connectionTime: number | null;
  timeToSecureConnection: number | null;
  waitingTime: number | null;
  downloadTime: number | null;
  durationTime: number | null;
}

export interface PageMetaData {
  title: string | null;
  description: string | null;
  generator: string | null;
  canonical: string | null;
  internalLinksCount: number | null;
  externalLinksCount: number | null;
  imagesCount: number | null;
  imagesSize: number | null;
  scriptsCount: number | null;
  scriptsSize: number | null;
  stylesheetsCount: number | null;
  stylesheetsSize: number | null;
  titleLength: number | null;
  descriptionLength: number | null;
  socialMediaTags: Record<string, string> | null;
  contentWordCount: number | null;
  automatedReadabilityIndex: number | null;
  fleschKincaidReadabilityIndex: number | null;
  descriptionToContentConsistency: number | null;
  titleToContentConsistency: number | null;
}

export interface PageChecks {
  isHttps: boolean;
  isHttp: boolean;
  isWww: boolean;
  isRedirect: boolean;
  is4xxCode: boolean;
  is5xxCode: boolean;
  isBroken: boolean;
  noContentEncoding: boolean;
  highLoadingTime: boolean;
  highWaitingTime: boolean;
  noDoctype: boolean;
  hasHtmlDoctype: boolean;
  noH1Tag: boolean;
  noTitle: boolean;
  noDescription: boolean;
  noFavicon: boolean;
  noImageAlt: boolean;
  noImageTitle: boolean;
  titleTooLong: boolean;
  titleTooShort: boolean;
  hasMetaTitle: boolean;
  deprecatedHtmlTags: boolean;
  duplicateMetaTags: boolean;
  duplicateTitleTag: boolean;
  lowContentRate: boolean;
  highContentRate: boolean;
  lowCharacterCount: boolean;
  lowReadabilityRate: boolean;
  irrelevantDescription: boolean;
  irrelevantTitle: boolean;
  hasMetaRefreshRedirect: boolean;
  hasRenderBlockingResources: boolean;
  httpsToHttpLinks: boolean;
  seoFriendlyUrl: boolean;
  hasFlash: boolean;
  hasFrame: boolean;
  loremIpsum: boolean;
  hasMicromarkup: boolean;
  sizeGreaterThan3mb: boolean;
}

export type DeathStage =
  | "HEAD_FAIL"
  | "DFS_PASS_1"
  | "DFS_PASS_2"
  | "DFS_PASS_3_NON_20000"
  | "ERROR_PAGE_TITLE"
  | "ERROR_PAGE_DOM";

export interface HtmlSignals {
  // Core metrics
  statusCode: number | null;
  fetchFailed: boolean;
  /** Set on dead-site signals to record which pipeline stage killed the URL. */
  deathStage?: DeathStage;
  onpageScore: number | null;
  totalDomSize: number | null;
  pageSize: number | null;
  encodedSize: number | null;
  server: string | null;
  contentEncoding: string | null;
  mediaType: string | null;

  // URL info
  finalUrl: string | null;
  isHttps: boolean;
  redirectedToHttps: boolean;

  // Content
  wordCount: number;
  hasMetaDescription: boolean;
  hasFavicon: boolean;
  deprecatedTagCount: number;
  copyrightYear: number | null;
  headerText: string;
  footerText: string;

  // Scripts & tracking
  hasAdPixel: boolean;
  hasAgencyFooter: boolean;

  // Broken resources
  hasBrokenResources: boolean;
  hasBrokenLinks: boolean;

  // Last modified
  lastModifiedHeader: string | null;
  lastModifiedSitemap: string | null;
  lastModifiedMetaTag: string | null;

  // Structured sub-objects
  pageTiming: PageTimingData | null;
  pageMeta: PageMetaData | null;
  pageChecks: PageChecks | null;
}

// ─── Scorer ───────────────────────────────────────────────────────────────────

export interface ScorerInput {
  website: string | null;
  htmlSignals: HtmlSignals | null;
  lighthousePerformance: number | null;
  lighthouseSeo: number | null;
  domainAgeYears: number | null;
  isExpiredDomain: boolean;
  // Business signals
  phone: string | null;
  isClaimed: boolean;
  currentStatus: string | null;
  permanentlyClosed: boolean;
  reviewCount: number | null;
  rating: number | null;
  ratingDistribution: Record<string, number> | null;
  firstSeen: string | null;
  // Legitimacy signals
  totalPhotos: number | null;
  hasFacebookLink: boolean;
  socialLinkCount: number;
  hasLogo: boolean;
  hasMainImage: boolean;
  hasAttributes: boolean;
  hasDescription: boolean;
  hasBusinessHours: boolean;
  address: string | null;
  // Legitimacy signals — nullable (future: reviews API)
  daysSinceLastReview: number | null;
  hasOwnerResponses: boolean;
  // Bonus legitimacy signals from DFS
  hasPeopleAlsoSearch: boolean;
  hasPlaceTopics: boolean;
}

export type BusinessLabel =
  | "no website"
  | "parked"
  | "dead site"
  | "defunct"
  | "disqualified"
  | "permanently closed"
  | "third-party listing"
  | "scored";

export interface ScoreBreakdown {
  total: number;
  reasons: string[];
  lighthousePerformance: number | null;
  lighthouseSeo: number | null;
  domainAgeYears: number | null;
  isExpiredDomain: boolean;
  isHttps: boolean | null;
  wordCount: number | null;
  hasMetaDescription: boolean | null;
  hasFavicon: boolean | null;
  fetchFailed: boolean | null;
  statusCode: number | null;
  onpageScore: number | null;
}

// ─── API Response ─────────────────────────────────────────────────────────────

export interface BusinessData {
  description: string | null;
  isClaimed: boolean;
  permanentlyClosed: boolean;
  additionalCategories: string[] | null;
  city: string | null;
  zip: string | null;
  region: string | null;
  ratingDistribution: Record<string, number> | null;
  priceLevel: string | null;
  currentStatus: string | null;
  emails: string[];
  socialLinks: Array<{ type: string; value: string }>;
  totalPhotos: number | null;
  placeTopics: Record<string, number> | null;
  logo: string | null;
  mainImage: string | null;
  lastUpdatedTime: string | null;
  firstSeen: string | null;
  checkUrl: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface LegitimacyBreakdown {
  total: number;
  reasons: string[];
}

export interface ScoredBusiness {
  cid: string | null;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  category: string | null;
  score: number | null;
  label: BusinessLabel;
  scoring: ScoreBreakdown | null;
  legitimacyScore: number;
  legitimacyBreakdown: LegitimacyBreakdown | null;
  businessData: BusinessData | null;
  websiteData: HtmlSignals | null;
}

export interface CostBreakdown {
  businessSearch: number;
  instantPages: number;
  lighthouse: number;
  totalDfs: number;
  firestoreReads: number;
  firestoreWrites: number;
  cachedBusinesses: number;
  freshBusinesses: number;
}

export interface SearchResponse {
  results: ScoredBusiness[];
  timedOut?: boolean;
  cost?: CostBreakdown;
}
// ─── Async Job Types ──────────────────────────────────────────────────────────

export type JobStatus = "running" | "completed" | "failed" | "cancelled";

export interface JobParams {
  keyword: string;
  location: string;
  radius: number;
  limit: number;
  creditCost: number;
}

export interface JobProgress {
  analyzed: number;
  total: number;
}

export interface JobDocument {
  uid: string;
  status: JobStatus;
  params: JobParams;
  progress: JobProgress;
  resultCount: number | null;
  error: string | null;
  cost: CostBreakdown | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  ttl: Timestamp;
}

export interface ResultDocument extends ScoredBusiness {
  uid: string;
}

export interface CreateJobResponse {
  jobId: string;
}

export interface CancelJobResponse {
  success: boolean;
}

// ─── Subscription ─────────────────────────────────────────────────────────────

export type SubscriptionPlan = "free" | "soloPro" | "agency" | "pro";
export type SubscriptionStatus = "active" | "past_due" | "cancelled" | "trialing";

export interface Subscription {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  creditsUsed: number;
  creditsTotal: number;
  currentPeriodStart: Timestamp | null;
  currentPeriodEnd: Timestamp | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  cancelAtPeriodEnd: boolean;
}

// ─── Plan configuration ───────────────────────────────────────────────────────
// Plan limits, pricing, and feature flags live in the Firestore `plans`
// collection (see functions/src/plans.ts). Do not hardcode plan data here.
// Use getPlanConfig() / getPlanCredits() from plans.ts at runtime.
export type { PlanConfig } from "./plans";

// ─── User Profile ─────────────────────────────────────────────────────────────

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  role: "user" | "admin";
  subscription: Subscription;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// API types matching the real backend response, plus a normalizer that maps
// them onto the existing `Business` shape used throughout the UI.

import type { Business, BusinessCategory, WebsiteAnalysis } from "./mockBusinesses";

export interface ApiScoring {
  total: number;
  reasons: string[];
  lighthousePerformance: number | null; // 0–1
  lighthouseSeo: number | null; // 0–1
  domainAgeYears: number | null;
  isExpiredDomain: boolean | null;
  isHttps: boolean | null;
  wordCount: number | null;
  hasMetaDescription: boolean | null;
  hasFavicon: boolean | null;
  fetchFailed: boolean | null;
  statusCode: number | null;
  onpageScore: number | null;
}

export interface ApiBusinessData {
  description: string | null;
  isClaimed: boolean;
  permanentlyClosed: boolean;
  additionalCategories: string[] | null;
  city: string | null;
  zip: string | null;
  region: string | null;
  ratingDistribution: Record<string, number> | null;
  priceLevel: string | null;
  currentStatus: "open" | "close" | string | null;
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

export interface ApiWebsiteData {
  statusCode: number | null;
  fetchFailed: boolean | null;
  onpageScore: number | null;
  totalDomSize: number | null;
  pageSize: number | null;
  encodedSize: number | null;
  server: string | null;
  contentEncoding: string | null;
  mediaType: string | null;
  finalUrl: string | null;
  isHttps: boolean | null;
  redirectedToHttps: boolean | null;
  wordCount: number | null;
  hasMetaDescription: boolean | null;
  hasFavicon: boolean | null;
  deprecatedTagCount: number | null;
  copyrightYear: number | null;
  headerText: string | null;
  footerText: string | null;
  hasAdPixel: boolean | null;
  hasAgencyFooter: boolean | null;
  hasBrokenResources: boolean | null;
  hasBrokenLinks: boolean | null;
  pageTiming: {
    timeToInteractive?: number | null;
    domComplete?: number | null;
    largestContentfulPaint?: number | null;
    [k: string]: number | null | undefined;
  } | null;
  pageMeta: {
    title?: string | null;
    description?: string | null;
    [k: string]: unknown;
  } | null;
  pageChecks: Record<string, boolean> | null;
  [k: string]: unknown;
}

export interface ApiLegitimacyBreakdown {
  total: number;
  reasons: string[];
}

export interface ApiBusiness {
  cid: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  category: string;
  score: number;
  label: string;
  scoring: ApiScoring;
  legitimacyScore: number;
  legitimacyBreakdown: ApiLegitimacyBreakdown | null;
  businessData: ApiBusinessData;
  websiteData: ApiWebsiteData | null;
  _cachedAt?: { _seconds: number; _nanoseconds: number };
}

/** Map API record → unified `Business` used by the UI. Null-safe. */
export function normalizeBusiness(api: ApiBusiness): Business {
  const bd = api.businessData;
  const wd = api.websiteData;
  const s = api.scoring;

  const hasWebsite = !!api.website;
  const seoScore = s.lighthouseSeo != null ? Math.round(s.lighthouseSeo * 100) : 0;
  const designScore = s.lighthousePerformance != null ? Math.round(s.lighthousePerformance * 100) : 0;
  const loadTimeMs = wd?.pageTiming?.timeToInteractive ?? 0;

  const analysis: WebsiteAnalysis = {
    hasWebsite,
    designScore,
    mobileFriendly: hasWebsite && designScore >= 50, // proxy until real signal
    hasHttps: !!(s.isHttps ?? wd?.isHttps),
    deprecatedHtmlTags: wd?.deprecatedTagCount ?? 0,
    websiteAge: s.domainAgeYears ?? 0,
    copyrightYear: wd?.copyrightYear ?? null,
    loadTimeMs,
    isParkedDomain: false,
    isExpiredDomain: !!s.isExpiredDomain,
    facebookAsWebsite: false,
    hasOnlineAds: !!wd?.hasAdPixel,
    hasMarketingAgency: !!wd?.hasAgencyFooter,
    seoScore,
    recentGoogleReviews: (api.reviewCount ?? 0) > 0,
    facebookActive: false,
    websiteUrl: api.website,
  };

  return {
    id: api.cid,
    name: api.name,
    category: api.category as BusinessCategory,
    address: api.address ?? "",
    city: bd.city ?? "",
    state: bd.region ?? "",
    zip: bd.zip ?? "",
    phone: api.phone ?? "",
    googleRating: api.rating ?? 0,
    reviewCount: api.reviewCount ?? 0,
    analysis,
    leadScore: api.score,
    // Extended fields (additive, optional consumers)
    label: api.label,
    reasons: s.reasons,
    description: bd.description,
    emails: bd.emails ?? [],
    isClaimed: bd.isClaimed,
    currentStatus: bd.currentStatus,
    additionalCategories: bd.additionalCategories ?? [],
    ratingDistribution: bd.ratingDistribution,
    logo: bd.logo,
    mainImage: bd.mainImage,
    checkUrl: bd.checkUrl,
    latitude: bd.latitude,
    longitude: bd.longitude,
    server: wd?.server ?? null,
    mediaType: wd?.mediaType ?? null,
    pageSize: wd?.pageSize ?? null,
    pageTitle: (wd?.pageMeta?.title as string) ?? null,
    pageDescription: (wd?.pageMeta?.description as string) ?? null,
    statusCode: s.statusCode ?? wd?.statusCode ?? null,
    fetchFailed: !!(s.fetchFailed ?? wd?.fetchFailed),
    legitimacyScore: api.legitimacyScore ?? 0,
    legitimacyReasons: api.legitimacyBreakdown?.reasons ?? [],
    socialLinks: bd.socialLinks ?? [],
    totalPhotos: bd.totalPhotos ?? null,
  };
}

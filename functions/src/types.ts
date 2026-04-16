export interface BusinessRaw {
  cid: string | null;
  title: string;
  address: string | null;
  phone: string | null;
  domain: string | null;
  url: string | null;
  rating: { value: number | null; votes_count: number | null } | null;
  category: string | null;
  is_claimed: boolean;
  permanently_closed: boolean;
}

export interface HtmlSignals {
  wordCount: number;
  hasMetaDescription: boolean;
  hasFavicon: boolean;
  isHttps: boolean;
  deprecatedTagCount: number;
  copyrightYear: number | null;
  headerText: string;
  footerText: string;
  hasAdPixel: boolean;
  hasAgencyFooter: boolean;
  statusCode: number | null;
  fetchFailed: boolean;
  redirectedToHttps: boolean;
  finalUrl: string | null;
}

export interface ScorerInput {
  website: string | null;
  htmlSignals: HtmlSignals | null;
  lighthousePerformance: number | null; // 0–1
  lighthouseSeo: number | null;         // 0–1
  domainAgeYears: number | null;
  isExpiredDomain: boolean;
}

export type BusinessLabel =
  | "no website"
  | "parked"
  | "dead site"
  | "third-party listing"
  | "opportunity"
  | "low opportunity";

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
}

export interface ScoredBusiness {
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
}

export interface SearchResponse {
  results: ScoredBusiness[];
  timedOut?: boolean;
}

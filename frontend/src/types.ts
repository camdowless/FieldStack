export interface PlaceResult {
  name: string;
  address: string;
  phone: string;
  website: string;
  types: string[];
  businessStatus: string;
  openNow: boolean | null;
  weekdayHours: string[];
  summary: string;
  zipCode: string;
}

export interface LeadAnalysis {
  leadScore: number;           // 0–100
  scoreReasons: string[];      // human-readable breakdown
  isExcluded: boolean;         // filtered out (software/agency/chain)
  excludeReason?: string;
  // website signals
  isHttps: boolean | null;
  isMobileFriendly: boolean | null;
  hasViewport: boolean | null;
  hasMediaQueries: boolean | null;
  copyrightYear: number | null;
  // wayback signals
  lastWaybackSeen: string | null;   // ISO date string or null
  waybackAgeYears: number | null;
  neverCrawled: boolean | null;
  // ads
  hasGoogleAds: boolean | null;
}

export interface AnalyzedResult extends PlaceResult {
  analysis: LeadAnalysis | null;
  analysisFailed?: boolean;
}

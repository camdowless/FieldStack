export type BusinessCategory = string;

export type LeadStatus = "saved" | "reached-out" | "in-conversation" | "proposal-sent" | "won" | "not-interested";

export interface WebsiteAnalysis {
  hasWebsite: boolean;
  designScore: number;
  mobileFriendly: boolean;
  hasHttps: boolean;
  deprecatedHtmlTags: number;
  websiteAge: number;
  copyrightYear: number | null;
  loadTimeMs: number;
  isParkedDomain: boolean;
  isExpiredDomain: boolean;
  facebookAsWebsite: boolean;
  hasOnlineAds: boolean;
  hasMarketingAgency: boolean;
  seoScore: number;
  recentGoogleReviews: boolean;
  facebookActive: boolean;
  websiteUrl: string | null;
}

export interface Business {
  id: string;
  name: string;
  category: BusinessCategory;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  googleRating: number;
  reviewCount: number;
  analysis: WebsiteAnalysis;
  leadScore: number;

  // Extended (from real API)
  label?: string;
  reasons?: string[];
  description?: string | null;
  emails?: string[];
  isClaimed?: boolean;
  currentStatus?: string | null;
  additionalCategories?: string[];
  ratingDistribution?: Record<string, number> | null;
  logo?: string | null;
  mainImage?: string | null;
  checkUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  server?: string | null;
  mediaType?: string | null;
  pageSize?: number | null;
  pageTitle?: string | null;
  pageDescription?: string | null;
  statusCode?: number | null;
  fetchFailed?: boolean;
  legitimacyScore?: number;
  legitimacyReasons?: string[];
  socialLinks?: Array<{ type: string; value: string }>;
  totalPhotos?: number | null;
}

// No longer derived from sample data — empty defaults for backward compat.
export const allCategories: string[] = [];
export const allCities: string[] = [];

// Kept for backward compatibility.
export function calculateLeadScore(_a: WebsiteAnalysis): number {
  return 0;
}

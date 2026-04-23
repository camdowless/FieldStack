import type { ApiBusiness } from "@/data/leadTypes";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";

// Firebase Hosting rewrites /api/search → the Cloud Function.
// In dev, Vite proxies /api → the emulator or deployed function.
const SEARCH_ENDPOINT = "/api/search";

/**
 * Get a Firebase ID token for API calls. Uses the cached token by default
 * (Firebase SDK auto-refreshes when near expiry). Handles the race condition
 * where auth.currentUser is null immediately after page load.
 *
 * Pass forceRefresh=true only after custom-claim changes (e.g. role updates).
 */
export async function getAuthToken(forceRefresh = false): Promise<string | null> {
  // Fast path: currentUser is already resolved
  if (auth.currentUser) {
    try {
      return await auth.currentUser.getIdToken(forceRefresh);
    } catch (err) {
      console.error("[getAuthToken] getIdToken failed", err);
      return null;
    }
  }

  // Slow path: auth.currentUser is null — wait for Firebase to resolve auth state
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      unsub();
      resolve(null);
    }, 5_000);

    const unsub = onAuthStateChanged(auth, async (user) => {
      clearTimeout(timeout);
      unsub();
      if (!user) {
        resolve(null);
        return;
      }
      try {
        resolve(await user.getIdToken(forceRefresh));
      } catch (err) {
        console.error("[getAuthToken] getIdToken failed", err);
        resolve(null);
      }
    });
  });
}

// ─── Input constraints (mirrored from backend) ───────────────────────────────

const MAX_KEYWORD_LEN = 120;
const MAX_LOCATION_LEN = 200;
const SAFE_TEXT_RE = /^[\p{L}\p{N}\s.,\-'&#/()_]+$/u;

function sanitize(raw: string, maxLen: number): string {
  return raw.trim().slice(0, maxLen);
}

function isValidInput(value: string): boolean {
  return value.length > 0 && SAFE_TEXT_RE.test(value);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SearchParams {
  keyword: string;
  location: string;
  radius?: number; // miles, default 10
}

export interface SearchApiResponse {
  results: ApiBusiness[];
  timedOut?: boolean;
  cost?: Record<string, number>;
}

export class SearchError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly isRetryable: boolean,
  ) {
    super(message);
    this.name = "SearchError";
  }
}

// ─── Response validation ──────────────────────────────────────────────────────

function isApiBusiness(item: unknown): item is ApiBusiness {
  if (typeof item !== "object" || item === null) return false;
  const obj = item as Record<string, unknown>;
  return (
    typeof obj.cid === "string" &&
    typeof obj.name === "string" &&
    (typeof obj.score === "number" || obj.score === null)
  );
}

function validateResponse(data: unknown): SearchApiResponse {
  if (typeof data !== "object" || data === null) {
    throw new SearchError("Invalid response from server", 0, true);
  }
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.results)) {
    throw new SearchError("Invalid response format", 0, true);
  }
  // Filter out any malformed entries rather than crashing
  const validResults = obj.results.filter(isApiBusiness);
  return {
    results: validResults as ApiBusiness[],
    timedOut: obj.timedOut === true,
    cost: typeof obj.cost === "object" && obj.cost !== null ? obj.cost as Record<string, number> : undefined,
  };
}

// ─── Job-based search API ─────────────────────────────────────────────────────

export async function createSearchJob(
  params: SearchParams,
): Promise<{ jobId: string }> {
  const keyword = sanitize(params.keyword, MAX_KEYWORD_LEN);
  const location = sanitize(params.location, MAX_LOCATION_LEN);

  if (!isValidInput(keyword)) {
    throw new SearchError(
      "Invalid keyword. Use letters, numbers, and basic punctuation only.",
      400,
      false,
    );
  }
  if (!isValidInput(location)) {
    throw new SearchError(
      "Invalid location. Use letters, numbers, and basic punctuation only.",
      400,
      false,
    );
  }

  const token = await getAuthToken();
  if (!token) {
    throw new SearchError("You must be signed in to search.", 401, false);
  }

  let res: Response;
  try {
    res = await fetch(SEARCH_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ keyword, location, radius: params.radius }),
    });
  } catch {
    throw new SearchError("Network error. Check your connection and try again.", 0, true);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const msg = typeof body?.error === "string" ? body.error : `Search failed (${res.status})`;
    const retryable = res.status >= 500 || res.status === 429;
    const code = typeof body?.code === "string" ? body.code : undefined;
    const err = new SearchError(msg, res.status, retryable);
    if (code) (err as SearchError & { code?: string }).code = code;
    throw err;
  }

  const data = await res.json().catch(() => null);
  if (!data || typeof data.jobId !== "string") {
    throw new SearchError("Invalid response from server", 0, true);
  }
  return { jobId: data.jobId };
}

const CANCEL_ENDPOINT = "/api/search/cancel";

export async function cancelSearchJob(
  jobId: string,
): Promise<{ success: boolean }> {
  const token = await getAuthToken();
  if (!token) {
    throw new SearchError("You must be signed in.", 401, false);
  }

  let res: Response;
  try {
    res = await fetch(CANCEL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jobId }),
    });
  } catch {
    throw new SearchError("Network error. Check your connection and try again.", 0, true);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const msg = typeof body?.error === "string" ? body.error : `Cancel failed (${res.status})`;
    throw new SearchError(msg, res.status, res.status >= 500);
  }

  return { success: true };
}

// ─── Fetch businesses by CIDs (free retrieval from cache) ─────────────────────

const BUSINESSES_ENDPOINT = "/api/businesses";

export async function fetchBusinessesByCids(
  cids: string[],
  signal?: AbortSignal,
): Promise<SearchApiResponse> {
  if (cids.length === 0) {
    return { results: [] };
  }

  const token = await getAuthToken();
  if (!token) {
    throw new SearchError("You must be signed in.", 401, false);
  }

  let res: Response;
  try {
    res = await fetch(BUSINESSES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ cids }),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new SearchError("Network error. Check your connection and try again.", 0, true);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const msg = typeof body?.error === "string" ? body.error : `Request failed (${res.status})`;
    throw new SearchError(msg, res.status, res.status >= 500 || res.status === 429);
  }

  const raw = await res.json().catch(() => null);
  return validateResponse(raw);
}


// ─── Recalculate full business rank for cached businesses ────────────────────

const RECALCULATE_ENDPOINT = "/api/recalculate-business-rank";

export async function recalculateBusinessRank(
  cids?: string[],
): Promise<{ processed: number; updated: number }> {
  const token = await getAuthToken();
  if (!token) {
    throw new SearchError("You must be signed in.", 401, false);
  }

  const res = await fetch(RECALCULATE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(cids ? { cids } : {}),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const msg = typeof body?.error === "string" ? body.error : `Request failed (${res.status})`;
    throw new SearchError(msg, res.status, res.status >= 500);
  }

  return res.json();
}

// ─── Re-evaluate a single business: full DFS/Lighthouse re-fetch ─────────────

const REEVALUATE_ENDPOINT = "/api/reevaluate-business";

export async function reevaluateBusiness(
  cid: string,
): Promise<{ result: ApiBusiness }> {
  const token = await getAuthToken();
  if (!token) {
    throw new SearchError("You must be signed in.", 401, false);
  }

  const res = await fetch(REEVALUATE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ cid }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const msg = typeof body?.error === "string" ? body.error : `Request failed (${res.status})`;
    throw new SearchError(msg, res.status, res.status >= 500);
  }

  return res.json();
}

export async function fetchBusinessPhotos(cid: string): Promise<Array<{ index: number; ext: string; data: string }>> {
  const token = await getAuthToken();
  if (!token) {
    throw new SearchError("You must be signed in.", 401, false);
  }

  const res = await fetch(`/api/photos?cid=${encodeURIComponent(cid)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const msg = typeof body?.error === "string" ? body.error : `Request failed (${res.status})`;
    throw new SearchError(msg, res.status, res.status >= 500);
  }

  const data = await res.json();
  return Array.isArray(data.photos) ? data.photos : [];
}

const GHOST_ENDPOINT = "/api/ghost-businesses";

export async function fetchGhostBusinesses(
  threshold = 25,
  limit = 50,
): Promise<{ results: ApiBusiness[]; threshold: number }> {
  const token = await getAuthToken();
  if (!token) {
    throw new SearchError("You must be signed in.", 401, false);
  }

  const res = await fetch(`${GHOST_ENDPOINT}?threshold=${threshold}&limit=${limit}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const msg = typeof body?.error === "string" ? body.error : `Request failed (${res.status})`;
    throw new SearchError(msg, res.status, res.status >= 500);
  }

  return res.json();
}

// ─── Submit a report for a business ──────────────────────────────────────────

const REPORT_ENDPOINT = "/api/report";

export type ReportReason = "wrong_ranking" | "wrong_signal" | "incorrect_info" | "other";

export async function submitReport(params: {
  cid: string;
  businessName: string;
  websiteUrl?: string;
  reason: ReportReason;
  details?: string;
}): Promise<{ reportId: string }> {
  const token = await getAuthToken();
  if (!token) {
    throw new SearchError("You must be signed in.", 401, false);
  }

  const res = await fetch(REPORT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const msg = typeof body?.error === "string" ? body.error : `Report failed (${res.status})`;
    throw new SearchError(msg, res.status, res.status >= 500);
  }

  return res.json();
}

// ─── Admin Reports ───────────────────────────────────────────────────────────

export interface AdminReportEntry {
  id: string;
  reason: string;
  details: string | null;
  uid: string; // resolved to email by backend
  status: string;
  createdAt: number | null;
}

export interface AdminReportGroup {
  cid: string;
  businessName: string;
  websiteUrl: string | null;
  reportCount: number;
  openCount: number;
  reasons: Record<string, number>;
  reports: AdminReportEntry[];
  latestAt: number | null;
}

export async function fetchAdminReports(
  status: "all" | "open" | "closed" = "all",
): Promise<{ groups: AdminReportGroup[] }> {
  const token = await getAuthToken();
  if (!token) throw new SearchError("You must be signed in.", 401, false);

  const res = await fetch(`/api/admin-reports?status=${status}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const msg = typeof body?.error === "string" ? body.error : `Request failed (${res.status})`;
    throw new SearchError(msg, res.status, res.status >= 500);
  }

  return res.json();
}

export async function updateReportStatus(
  reportId: string,
  status: "open" | "closed",
): Promise<void> {
  const token = await getAuthToken();
  if (!token) throw new SearchError("You must be signed in.", 401, false);

  const res = await fetch("/api/update-report-status", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ reportId, status }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const msg = typeof body?.error === "string" ? body.error : `Request failed (${res.status})`;
    throw new SearchError(msg, res.status, res.status >= 500);
  }
}

// ─── Admin: Audit Dead Sites ──────────────────────────────────────────────────

export interface DeadSiteAuditRow {
  cid: string;
  name: string;
  url: string;
  label: string;
  deathStage: string;
  fetchFailed: boolean;
  statusCode: number | string;
  headErrorCode: string;
  dfsTaskStatusCode: number | string;
  pageTitle: string;
  totalDomSize: number | string;
  wordCount: number | string;
}

export async function auditDeadSites(
  cids: string[],
): Promise<{ rows: DeadSiteAuditRow[]; cost: number }> {
  const token = await getAuthToken();
  if (!token) throw new SearchError("You must be signed in.", 401, false);

  const res = await fetch("/api/audit-dead-sites", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ cids }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const msg = typeof body?.error === "string" ? body.error : `Request failed (${res.status})`;
    throw new SearchError(msg, res.status, res.status >= 500);
  }

  return res.json();
}

// ─── Admin Stats ──────────────────────────────────────────────────────────────

export interface AdminSearchEntry {
  id: string;
  path: string;
  uid: string;
  query: string;
  location: string;
  resultCount: number;
  createdAt: { seconds: number } | null;
  qualityLeadCount?: number;
  cost?: {
    businessSearch: number;
    instantPages: number;
    lighthouse: number;
    totalDfs: number;
    firestoreReads: number;
    firestoreWrites: number;
    cachedBusinesses: number;
    freshBusinesses: number;
  } | null;
}

export interface AdminStatsResponse {
  totalSearches: number;
  totalResultCount: number;
  totalDfsCost: number;
  totalBusinessesIndexed: number;
  avgCostPerSearch: number;
  avgResultsPerSearch: number;
  breakdown: {
    totalBusinessSearch: number;
    totalInstantPages: number;
    totalLighthouse: number;
    totalCachedBusinesses: number;
    totalFreshBusinesses: number;
  };
  highOpportunityCount: number;
  pctHighOpportunity: number;
  lastUpdated: { seconds: number } | { _seconds: number } | string | null;
}

export async function fetchAdminStats(): Promise<AdminStatsResponse> {
  const token = await getAuthToken();
  if (!token) throw new SearchError("You must be signed in.", 401, false);

  const res = await fetch(`/api/admin-stats`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const msg = typeof body?.error === "string" ? body.error : `Request failed (${res.status})`;
    throw new SearchError(msg, res.status, res.status >= 500);
  }

  return res.json();
}

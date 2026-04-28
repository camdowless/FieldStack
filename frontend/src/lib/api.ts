import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";

/**
 * Get a Firebase ID token for API calls. Uses the cached token by default
 * (Firebase SDK auto-refreshes when near expiry). Handles the race condition
 * where auth.currentUser is null immediately after page load.
 *
 * Pass forceRefresh=true only after custom-claim changes (e.g. role updates).
 */
export async function getAuthToken(forceRefresh = false): Promise<string | null> {
  if (auth.currentUser) {
    try {
      return await auth.currentUser.getIdToken(forceRefresh);
    } catch (err) {
      console.error("[getAuthToken] getIdToken failed", err);
      return null;
    }
  }

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

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly isRetryable: boolean,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ─── Admin Reports ───────────────────────────────────────────────────────────

export interface AdminReportEntry {
  id: string;
  reason: string;
  details: string | null;
  uid: string;
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
  if (!token) throw new ApiError("You must be signed in.", 401, false);

  const res = await fetch(`/api/admin-reports?status=${status}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const msg = typeof body?.error === "string" ? body.error : `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, res.status >= 500);
  }

  return res.json();
}

export async function updateReportStatus(
  reportId: string,
  status: "open" | "closed",
): Promise<void> {
  const token = await getAuthToken();
  if (!token) throw new ApiError("You must be signed in.", 401, false);

  const res = await fetch("/api/update-report-status", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ reportId, status }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const msg = typeof body?.error === "string" ? body.error : `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, res.status >= 500);
  }
}

// ─── Admin Stats ──────────────────────────────────────────────────────────────

export interface AdminStatsResponse {
  totalUsers: number;
  lastUpdated: { seconds: number } | { _seconds: number } | string | null;
}

export async function fetchAdminStats(): Promise<AdminStatsResponse> {
  const token = await getAuthToken();
  if (!token) throw new ApiError("You must be signed in.", 401, false);

  const res = await fetch(`/api/admin-stats`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const msg = typeof body?.error === "string" ? body.error : `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, res.status >= 500);
  }

  return res.json();
}

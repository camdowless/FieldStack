import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";

/**
 * Get a Firebase ID token for API calls.
 * Uses the cached token by default (Firebase SDK auto-refreshes when near expiry).
 * Handles the race condition where auth.currentUser is null immediately after page load.
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
    const timeout = setTimeout(() => { unsub(); resolve(null); }, 5_000);
    const unsub = onAuthStateChanged(auth, async (user) => {
      clearTimeout(timeout);
      unsub();
      if (!user) { resolve(null); return; }
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

// ─── Support Ticket ───────────────────────────────────────────────────────────

export type SupportCategory = "billing" | "bug" | "account" | "feature_request" | "other";

export async function submitSupportTicket(params: {
  category: SupportCategory;
  subject: string;
  message: string;
  replyEmail?: string;
}): Promise<{ ticketId: string }> {
  const token = await getAuthToken();
  if (!token) throw new ApiError("You must be signed in.", 401, false);

  const res = await fetch("/api/support", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const msg = typeof body?.error === "string" ? body.error : `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, res.status >= 500);
  }

  return res.json();
}

// ─── Items API ────────────────────────────────────────────────────────────────
// These are the canonical example API calls. Replace or extend for your product.

export interface Item {
  id: string;
  title: string;
  description: string;
  status: "active" | "archived";
  createdAt?: unknown;
  updatedAt?: unknown;
}

export async function fetchItems(): Promise<Item[]> {
  const token = await getAuthToken();
  if (!token) throw new ApiError("You must be signed in.", 401, false);

  const res = await fetch("/api/items", {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status, res.status >= 500);
  }

  const data = await res.json();
  return data.items ?? [];
}

export async function createItem(params: { title: string; description?: string }): Promise<Item> {
  const token = await getAuthToken();
  if (!token) throw new ApiError("You must be signed in.", 401, false);

  const res = await fetch("/api/items", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status, res.status >= 500);
  }

  return res.json();
}

export async function updateItem(id: string, params: { title?: string; description?: string; status?: "active" | "archived" }): Promise<Item> {
  const token = await getAuthToken();
  if (!token) throw new ApiError("You must be signed in.", 401, false);

  const res = await fetch(`/api/items/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status, res.status >= 500);
  }

  return res.json();
}

export async function deleteItem(id: string): Promise<void> {
  const token = await getAuthToken();
  if (!token) throw new ApiError("You must be signed in.", 401, false);

  const res = await fetch(`/api/items/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status, res.status >= 500);
  }
}

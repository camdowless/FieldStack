import { useState, useCallback, useRef, useEffect } from "react";
import {
  doc,
  getDoc,
  collection,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { firestore, auth } from "@/lib/firebase";
import { normalizeBusiness, type ApiBusiness } from "@/data/leadTypes";
import type { Business } from "@/data/mockBusinesses";

// ─── Job persistence ───────────────────────────────────────────────────────────

interface PersistedJob {
  jobId: string;
  keyword: string;
  location: string;
}

const STORAGE_KEY = (uid: string) => `searchJob:${uid}`;

function saveActiveJob(uid: string, data: PersistedJob) {
  try { localStorage.setItem(STORAGE_KEY(uid), JSON.stringify(data)); } catch { /* storage unavailable */ }
}

function clearActiveJob(uid: string) {
  try { localStorage.removeItem(STORAGE_KEY(uid)); } catch { /* storage unavailable */ }
}

function loadActiveJob(uid: string): PersistedJob | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Support legacy format where only a jobId string was stored
    if (typeof parsed === "string") return { jobId: parsed, keyword: "", location: "" };
    return parsed as PersistedJob;
  } catch { return null; }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type JobStatus = "idle" | "creating" | "running" | "completed" | "failed" | "cancelled" | "rate_limited";

export interface SearchJobProgress {
  analyzed: number;
  total: number;
}

export interface SearchJobState {
  jobId: string | null;
  status: JobStatus;
  progress: SearchJobProgress | null;
  results: Business[];
  error: string | null;
  cost: Record<string, number> | null;
  retryAfter: number | null; // seconds until rate limit resets
}

export interface UseSearchJobReturn extends SearchJobState {
  startSearch: (params: { keyword: string; location: string; radius?: number; limit?: number }) => Promise<void>;
  cancelSearch: () => Promise<void>;
  reset: () => void;
  /** The params used for the active/rehydrated search, so the UI can restore labels. */
  activeParams: { keyword: string; location: string } | null;
}

// ─── Pure helpers (exported for testing) ──────────────────────────────────────

/** Sort businesses by score descending, null scores last. */
export function sortByScoreDesc(businesses: Business[]): Business[] {
  return [...businesses].sort((a, b) => {
    const aNull = a.leadScore == null;
    const bNull = b.leadScore == null;
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    return b.leadScore - a.leadScore;
  });
}

/**
 * Derive the UI display state from job status and progress.
 * Returns a descriptor the UI can use to pick the right message.
 */
export type ProgressDisplayState =
  | { kind: "idle" }
  | { kind: "generic-loading" }
  | { kind: "analyzing"; analyzed: number; total: number }
  | { kind: "no-results" }
  | { kind: "completed" }
  | { kind: "failed" }
  | { kind: "cancelled" };

export function deriveProgressDisplay(
  status: JobStatus,
  progress: SearchJobProgress | null,
): ProgressDisplayState {
  if (status === "idle" || status === "creating") return { kind: "idle" };
  if (status === "failed") return { kind: "failed" };
  if (status === "cancelled") return { kind: "cancelled" };

  if (status === "running") {
    if (progress == null || progress.total === 0) {
      // total 0 while running means we haven't gotten the DFS count yet
      return { kind: "generic-loading" };
    }
    return { kind: "analyzing", analyzed: progress.analyzed, total: progress.total };
  }

  // status === "completed"
  if (progress != null && progress.total === 0) {
    return { kind: "no-results" };
  }
  return { kind: "completed" };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSearchJob(): UseSearchJobReturn {
  const [state, setState] = useState<SearchJobState>({
    jobId: null,
    status: "idle",
    progress: null,
    results: [],
    error: null,
    cost: null,
    retryAfter: null,
  });

  const [activeParams, setActiveParams] = useState<{ keyword: string; location: string } | null>(null);

  // Track listener unsubscribers
  const unsubJobRef = useRef<Unsubscribe | null>(null);
  const unsubResultsRef = useRef<Unsubscribe | null>(null);

  // Track completion-race state: when job says "completed" but we haven't
  // received all result docs yet, we hold off on tearing down.
  const expectedCountRef = useRef<number | null>(null);
  const localCountRef = useRef<number>(0);
  const completedRef = useRef(false);

  const teardown = useCallback((uid?: string) => {
    unsubJobRef.current?.();
    unsubResultsRef.current?.();
    unsubJobRef.current = null;
    unsubResultsRef.current = null;
    expectedCountRef.current = null;
    localCountRef.current = 0;
    completedRef.current = false;
    if (uid) clearActiveJob(uid);
    setActiveParams(null);
  }, []);

  // Teardown on unmount
  useEffect(() => () => teardown(), [teardown]);

  const maybeFinalize = useCallback((uid?: string) => {
    if (
      completedRef.current &&
      expectedCountRef.current != null &&
      localCountRef.current >= expectedCountRef.current
    ) {
      teardown(uid);
    }
  }, [teardown]);

  // ── Attach Firestore listeners for a known jobId ──────────────────────────
  const attachListeners = useCallback((jobId: string, uid: string) => {
    // job doc listener
    const jobDocRef = doc(firestore, "jobs", jobId);
    unsubJobRef.current = onSnapshot(
      jobDocRef,
      (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        const jobStatus = d.status as "running" | "completed" | "failed" | "cancelled";
        const progress = d.progress
          ? { analyzed: d.progress.analyzed ?? 0, total: d.progress.total ?? 0 }
          : null;

        console.log(`[useSearchJob] Job status: ${jobStatus}, progress:`, progress, `resultCount: ${d.resultCount}`);

        if (jobStatus === "completed") {
          const resultCount = typeof d.resultCount === "number" ? d.resultCount : 0;
          const cost = d.cost ?? null;
          expectedCountRef.current = resultCount;
          completedRef.current = true;
          setState((s) => ({ ...s, status: "completed", progress, cost }));
          maybeFinalize(uid);
        } else if (jobStatus === "failed") {
          setState((s) => ({ ...s, status: "failed", progress, error: d.error || "An unexpected error occurred." }));
          teardown(uid);
        } else if (jobStatus === "cancelled") {
          setState((s) => ({ ...s, status: "cancelled", progress }));
          teardown(uid);
        } else {
          setState((s) => ({ ...s, status: "running", progress }));
        }
      },
      (err) => {
        console.error("[useSearchJob] Job doc listener error:", err);
        setState((s) => ({ ...s, status: "failed", error: "Lost connection to search job. Please try again." }));
        teardown(uid);
      },
    );

    // results subcollection listener
    const resultsColRef = collection(firestore, "jobs", jobId, "results");
    const resultsQuery = query(resultsColRef, where("uid", "==", uid));
    unsubResultsRef.current = onSnapshot(
      resultsQuery,
      (snap) => {
        const businesses: Business[] = [];
        snap.forEach((docSnap) => {
          businesses.push(normalizeBusiness(docSnap.data() as ApiBusiness));
        });
        const sorted = sortByScoreDesc(businesses);
        localCountRef.current = sorted.length;
        console.log(`[useSearchJob] Results snapshot: ${sorted.length} businesses received`);
        setState((s) => ({ ...s, results: sorted }));
        maybeFinalize(uid);
      },
      (err) => {
        console.error("[useSearchJob] Results listener error:", err);
        setState((s) => ({ ...s, status: "failed", error: "Lost connection to search results. Please try again." }));
        teardown(uid);
      },
    );
  }, [teardown, maybeFinalize]);

  // ── Rehydrate in-progress job after page refresh ──────────────────────────
  useEffect(() => {
    // Wait for Firebase auth to resolve, then check localStorage for a saved job
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      const saved = loadActiveJob(user.uid);
      if (!saved) return;

      // Force-refresh the token so role claims are present before the Firestore read
      try {
        await user.getIdToken();
      } catch (err) {
        console.warn("[useSearchJob] Token refresh failed, skipping rehydration:", err);
        return;
      }

      // Peek at the job doc to decide what to do
      try {
        const snap = await getDoc(doc(firestore, "jobs", saved.jobId));
        if (!snap.exists()) {
          clearActiveJob(user.uid);
          return;
        }
        const d = snap.data();
        const jobStatus = d.status as string;

        if (jobStatus === "running") {
          // Job is still going — reattach listeners and restore UI state
          console.log(`[useSearchJob] Rehydrating in-progress job: ${saved.jobId}`);
          setState((s) => ({ ...s, jobId: saved.jobId, status: "running" }));
          setActiveParams({ keyword: saved.keyword, location: saved.location });
          attachListeners(saved.jobId, user.uid);
        } else {
          // Job already finished while we were away — just clear storage
          clearActiveJob(user.uid);
        }
      } catch (err) {
        console.warn("[useSearchJob] Rehydration check failed:", err);
        clearActiveJob(user.uid);
      }
    });
    return unsub;
  }, [attachListeners]);

  const startSearch = useCallback(
    async (params: { keyword: string; location: string; radius?: number; limit?: number }) => {
      // Clean up any previous job listeners
      teardown();

      setState({
        jobId: null,
        status: "creating",
        progress: null,
        results: [],
        error: null,
        cost: null,
        retryAfter: null,
      });

      // Get auth token
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        setState((s) => ({ ...s, status: "failed", error: "You must be signed in to search." }));
        return;
      }

      // Call Job_Creator
      let jobId: string;
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(params),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText }));
          if (res.status === 429) {
            const retryAfter = typeof body?.retryAfter === "number" ? body.retryAfter : 60;
            setState((s) => ({ ...s, status: "rate_limited", retryAfter }));
            return;
          }
          const msg = typeof body?.error === "string" ? body.error : `Search failed (${res.status})`;
          setState((s) => ({ ...s, status: "failed", error: msg }));
          return;
        }

        const data = await res.json();
        jobId = data.jobId;
      } catch {
        setState((s) => ({
          ...s,
          status: "failed",
          error: "Network error. Check your connection and try again.",
        }));
        return;
      }

      setState((s) => ({ ...s, jobId, status: "running" }));

      console.log(`[useSearchJob] Job created: ${jobId}, setting up listeners`);

      const uid = auth.currentUser?.uid;
      if (!uid) {
        setState((s) => ({ ...s, status: "failed", error: "Authentication lost. Please sign in and try again." }));
        teardown();
        return;
      }

      // Persist so a refresh can rehydrate
      saveActiveJob(uid, { jobId, keyword: params.keyword, location: params.location });
      setActiveParams({ keyword: params.keyword, location: params.location });

      attachListeners(jobId, uid);
    },
    [teardown, attachListeners],
  );

  const cancelSearch = useCallback(async () => {
    if (!state.jobId) return;

    const token = await auth.currentUser?.getIdToken();
    if (!token) return;

    try {
      await fetch("/api/search/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ jobId: state.jobId }),
      });
    } catch {
      // Cancellation is best-effort; the job doc listener will pick up the status change
    }
  }, [state.jobId]);

  const reset = useCallback(() => {
    const uid = auth.currentUser?.uid;
    teardown(uid ?? undefined);
    setActiveParams(null);
    setState({
      jobId: null,
      status: "idle",
      progress: null,
      results: [],
      error: null,
      cost: null,
      retryAfter: null,
    });
  }, [teardown]);

  return {
    ...state,
    activeParams,
    startSearch,
    cancelSearch,
    reset,
  };
}

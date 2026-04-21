import { useState, useCallback, useRef, useEffect } from "react";
import {
  doc,
  collection,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { firestore, auth } from "@/lib/firebase";
import { normalizeBusiness, type ApiBusiness } from "@/data/leadTypes";
import type { Business } from "@/data/mockBusinesses";

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

  // Track listener unsubscribers
  const unsubJobRef = useRef<Unsubscribe | null>(null);
  const unsubResultsRef = useRef<Unsubscribe | null>(null);

  // Track completion-race state: when job says "completed" but we haven't
  // received all result docs yet, we hold off on tearing down.
  const expectedCountRef = useRef<number | null>(null);
  const localCountRef = useRef<number>(0);
  const completedRef = useRef(false);

  const teardown = useCallback(() => {
    unsubJobRef.current?.();
    unsubResultsRef.current?.();
    unsubJobRef.current = null;
    unsubResultsRef.current = null;
    expectedCountRef.current = null;
    localCountRef.current = 0;
    completedRef.current = false;
  }, []);

  // Teardown on unmount
  useEffect(() => teardown, [teardown]);

  const maybeFinalize = useCallback(() => {
    if (
      completedRef.current &&
      expectedCountRef.current != null &&
      localCountRef.current >= expectedCountRef.current
    ) {
      teardown();
    }
  }, [teardown]);

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

      // ── Set up job doc listener ──
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

            setState((s) => ({
              ...s,
              status: "completed",
              progress,
              cost,
            }));

            // Check if results already caught up
            maybeFinalize();
          } else if (jobStatus === "failed") {
            setState((s) => ({
              ...s,
              status: "failed",
              progress,
              error: d.error || "An unexpected error occurred.",
            }));
            teardown();
          } else if (jobStatus === "cancelled") {
            setState((s) => ({ ...s, status: "cancelled", progress }));
            teardown();
          } else {
            // still running
            setState((s) => ({ ...s, status: "running", progress }));
          }
        },
        (err) => {
          console.error("[useSearchJob] Job doc listener error:", err);
          setState((s) => ({
            ...s,
            status: "failed",
            error: "Lost connection to search job. Please try again.",
          }));
          teardown();
        },
      );

      // ── Set up results subcollection listener ──
      const resultsColRef = collection(firestore, "jobs", jobId, "results");
      const uid = auth.currentUser?.uid;
      const resultsQuery = uid
        ? query(resultsColRef, where("uid", "==", uid))
        : resultsColRef;
      unsubResultsRef.current = onSnapshot(
        resultsQuery,
        (snap) => {
          const businesses: Business[] = [];
          snap.forEach((docSnap) => {
            const data = docSnap.data() as ApiBusiness;
            businesses.push(normalizeBusiness(data));
          });

          const sorted = sortByScoreDesc(businesses);
          localCountRef.current = sorted.length;

          console.log(`[useSearchJob] Results snapshot: ${sorted.length} businesses received`);

          setState((s) => ({ ...s, results: sorted }));

          // If job already completed, check convergence
          maybeFinalize();
        },
        (err) => {
          console.error("[useSearchJob] Results listener error:", err);
          setState((s) => ({
            ...s,
            status: "failed",
            error: "Lost connection to search results. Please try again.",
          }));
          teardown();
        },
      );
    },
    [teardown, maybeFinalize],
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
    teardown();
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
    startSearch,
    cancelSearch,
    reset,
  };
}

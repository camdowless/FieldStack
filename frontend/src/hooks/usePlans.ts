/**
 * usePlans — fetches the `plans` collection from Firestore once and caches it.
 *
 * Returns plans sorted by sortOrder. Components use this instead of any
 * hardcoded plan arrays.
 */

import { useEffect, useState } from "react";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import type { PlanConfig } from "@/lib/planFeatures";

interface UsePlansResult {
  plans: PlanConfig[];
  loading: boolean;
  error: string | null;
}

let _cachedPlans: PlanConfig[] | null = null;

export function usePlans(): UsePlansResult {
  const [plans, setPlans] = useState<PlanConfig[]>(_cachedPlans ?? []);
  const [loading, setLoading] = useState(_cachedPlans === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (_cachedPlans !== null) return; // already loaded

    let cancelled = false;
    (async () => {
      try {
        const q = query(collection(firestore, "plans"), orderBy("sortOrder", "asc"));
        const snap = await getDocs(q);
        const result = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as PlanConfig));
        _cachedPlans = result;
        if (!cancelled) setPlans(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load plans");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return { plans, loading, error };
}

/** Returns the PlanConfig for a given plan ID, or null. */
export function usePlanConfig(planId: string | undefined): PlanConfig | null {
  const { plans } = usePlans();
  if (!planId) return null;
  return plans.find((p) => p.id === planId) ?? null;
}

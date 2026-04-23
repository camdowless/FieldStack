import { useState, useEffect } from "react";
import { fetchAdminStats, type AdminStatsResponse } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

export type AdminStats = AdminStatsResponse & {
  loading: boolean;
  error: string | null;
};

export function useAdminStats(): AdminStats {
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<AdminStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !user) return;
    setLoading(true);
    fetchAdminStats()
      .then((d) => { setData(d); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : "Unknown error"))
      .finally(() => setLoading(false));
  }, [user, authLoading]);

  return {
    totalSearches: data?.totalSearches ?? 0,
    totalResultCount: data?.totalResultCount ?? 0,
    totalDfsCost: data?.totalDfsCost ?? 0,
    totalBusinessesIndexed: data?.totalBusinessesIndexed ?? 0,
    avgCostPerSearch: data?.avgCostPerSearch ?? 0,
    avgResultsPerSearch: data?.avgResultsPerSearch ?? 0,
    breakdown: data?.breakdown ?? {
      totalBusinessSearch: 0,
      totalInstantPages: 0,
      totalLighthouse: 0,
      totalCachedBusinesses: 0,
      totalFreshBusinesses: 0,
    },
    highOpportunityCount: data?.highOpportunityCount ?? 0,
    pctHighOpportunity: data?.pctHighOpportunity ?? 0,
    lastUpdated: data?.lastUpdated ?? null,
    loading,
    error,
  };
}

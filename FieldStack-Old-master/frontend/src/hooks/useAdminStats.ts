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
    totalUsers: data?.totalUsers ?? 0,
    lastUpdated: data?.lastUpdated ?? null,
    loading,
    error,
  };
}

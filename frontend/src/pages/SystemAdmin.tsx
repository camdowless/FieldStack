import { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { ShieldAlert, RefreshCw, Users } from "lucide-react";
import { DevRateLimitTester } from "@/components/DevRateLimitTester";
import { DevLogTester } from "@/components/DevLogTester";
import { getAuthToken } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";

interface AdminStats {
  totalUsers?: number;
  lastUpdated?: unknown;
}

function useAdminStats() {
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!user) return;
    setLoading(true);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error("Not authenticated");
      const res = await fetch("/api/admin-stats", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authLoading && user) load();
  // load is stable (defined outside effect), safe to omit
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading]);

  return { data, loading, error, reload: load };
}

function StatRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between py-2.5 border-b last:border-0">
      <div className="flex items-baseline gap-2">
        <span className="text-sm">{label}</span>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </div>
      <span className="font-mono text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}

export default function SystemAdmin() {
  const { data, loading, error, reload } = useAdminStats();

  const lastUpdatedStr = data?.lastUpdated
    ? (() => {
        const ts = data.lastUpdated as { seconds?: number; _seconds?: number } | string;
        const secs = typeof ts === "string" ? Date.parse(ts) / 1000 : ((ts as { seconds?: number }).seconds ?? (ts as { _seconds?: number })._seconds ?? 0);
        const d = new Date(secs * 1000);
        return isNaN(d.getTime()) ? null : d.toLocaleString();
      })()
    : null;

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-2 mb-1">
          <ShieldAlert className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">System Admin</h1>
        </div>
        <p className="text-sm text-muted-foreground">Platform-wide stats and developer tools</p>
      </motion.div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="devtools">Dev Tools</TabsTrigger>
        </TabsList>

        {/* Overview tab */}
        <TabsContent value="overview" className="space-y-6 mt-6">
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold">Platform Stats</h2>
              <div className="flex items-center gap-3">
                {lastUpdatedStr && <span className="text-xs text-muted-foreground">Updated {lastUpdatedStr}</span>}
                <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>
            </div>

            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-9 rounded-md" />)}
              </div>
            ) : error ? (
              <p className="text-sm text-destructive">Failed to load stats: {error}</p>
            ) : (
              <div className="rounded-lg border px-4">
                <StatRow
                  label="Total users"
                  value={data?.totalUsers?.toLocaleString() ?? "0"}
                  sub="registered accounts"
                />
                {/* Add your app-specific stats here */}
              </div>
            )}
          </section>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" /> User Management
              </CardTitle>
              <CardDescription>
                User management is handled via the Firebase Console. Use the Admin SDK scripts in
                <code className="text-xs bg-muted px-1 py-0.5 rounded ml-1">functions/scripts/</code> for bulk operations.
              </CardDescription>
            </CardHeader>
          </Card>
        </TabsContent>

        {/* Dev Tools tab */}
        <TabsContent value="devtools" className="space-y-4 mt-6">
          <DevRateLimitTester />
          <DevLogTester />
        </TabsContent>
      </Tabs>
    </div>
  );
}

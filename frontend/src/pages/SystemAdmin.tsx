import { motion } from "framer-motion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAdminStats } from "@/hooks/useAdminStats";
import { ShieldAlert } from "lucide-react";

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-2.5 border-b last:border-0">
      <span className="text-sm">{label}</span>
      <span className="font-mono text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}

export default function SystemAdmin() {
  const { totalUsers, loading, error, lastUpdated } = useAdminStats();

  const lastUpdatedStr = lastUpdated
    ? (() => {
        const ts = lastUpdated as unknown as { seconds?: number; _seconds?: number } | string;
        const secs = typeof ts === "string" ? Date.parse(ts) / 1000 : (ts.seconds ?? ts._seconds ?? 0);
        const d = new Date(secs * 1000);
        return isNaN(d.getTime()) ? null : d.toLocaleString();
      })()
    : null;

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-2 mb-1">
          <ShieldAlert className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">System Admin</h1>
        </div>
        <p className="text-sm text-muted-foreground">Platform-wide analytics and admin tools</p>
      </motion.div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 mt-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Platform Stats</CardTitle>
              {lastUpdatedStr && (
                <CardDescription>Last updated {lastUpdatedStr}</CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9 rounded-md" />)}
                </div>
              ) : error ? (
                <p className="text-sm text-destructive">Failed to load stats: {error}</p>
              ) : (
                <div className="rounded-lg border px-4">
                  <StatRow label="Total users" value={totalUsers.toLocaleString()} />
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="text-base">Add your admin tools here</CardTitle>
              <CardDescription>
                Wire up backend operations, data management, or analytics specific to your product.
              </CardDescription>
            </CardHeader>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

import { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/hooks/use-toast";
import { recalculateBusinessRank, fetchGhostBusinesses } from "@/lib/api";
import { useAdminStats } from "@/hooks/useAdminStats";
import type { ApiBusiness } from "@/data/leadTypes";
import { ShieldAlert, Database, Search, DollarSign, RefreshCw, Ghost, TrendingUp, Layers } from "lucide-react";
import { DevRateLimitTester } from "@/components/DevRateLimitTester";

function StatCard({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold tabular-nums">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function fmt$(n: number) { return n === 0 ? "$0.0000" : `$${n.toFixed(4)}`; }
function fmtN(n: number) { return n.toLocaleString(); }

export default function SystemAdmin() {
  const {
    totalSearches, totalResultCount, totalDfsCost,
    totalBusinessesIndexed, avgCostPerSearch, avgResultsPerSearch,
    breakdown, lastUpdated, loading, error,
  } = useAdminStats();

  const [recalculating, setRecalculating] = useState(false);
  const [loadingGhosts, setLoadingGhosts] = useState(false);
  const [ghosts, setGhosts] = useState<ApiBusiness[] | null>(null);

  const handleRecalculate = async () => {
    setRecalculating(true);
    try {
      const result = await recalculateBusinessRank();
      toast({ title: "Business ranks recalculated", description: `Processed ${result.processed} businesses, updated ${result.updated}.`, duration: Infinity });
    } catch (err) {
      toast({ title: "Recalculation failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setRecalculating(false); }
  };

  const handleLoadGhosts = async () => {
    setLoadingGhosts(true);
    try {
      const result = await fetchGhostBusinesses(40, 100);
      setGhosts(result.results.sort((a, b) => (b.legitimacyScore ?? 0) - (a.legitimacyScore ?? 0)));
    } catch (err) {
      toast({ title: "Failed to load ghost businesses", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setLoadingGhosts(false);
    }
  };

  const lastUpdatedStr = lastUpdated
    ? (() => {
        // Firestore timestamp can come back as { seconds } or { _seconds } or an ISO string
        const ts = lastUpdated as unknown as { seconds?: number; _seconds?: number } | string;
        const secs = typeof ts === "string" ? Date.parse(ts) / 1000 : (ts.seconds ?? ts._seconds ?? 0);
        const d = new Date(secs * 1000);
        return isNaN(d.getTime()) ? null : d.toLocaleString();
      })()
    : null;

  return (
    <div className="p-6 max-w-5xl space-y-8">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-2 mb-1">
          <ShieldAlert className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">System Admin</h1>
        </div>
        <p className="text-sm text-muted-foreground">Dev tools and platform-wide analytics</p>
      </motion.div>

      {/* ── Pricing Tracker ─────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">Pricing Tracker</h2>
          {lastUpdatedStr && <span className="text-xs text-muted-foreground">Last updated {lastUpdatedStr}</span>}
        </div>

        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">Failed to load stats: {error}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
              <StatCard icon={Search} label="Total Searches" value={fmtN(totalSearches)} sub="all users, all time" />
              <StatCard icon={Layers} label="Total Results" value={fmtN(totalResultCount)} sub="businesses analyzed" />
              <StatCard icon={Database} label="Businesses Indexed" value={fmtN(totalBusinessesIndexed)} sub="in Firestore cache" />
              <StatCard icon={DollarSign} label="Total DFS Cost" value={fmt$(totalDfsCost)} sub="all time" />
              <StatCard icon={TrendingUp} label="Avg Cost / Search" value={fmt$(avgCostPerSearch)} sub="DataForSEO API" />
              <StatCard icon={TrendingUp} label="Avg Results / Search" value={avgResultsPerSearch > 0 ? avgResultsPerSearch.toFixed(1) : "—"} sub="businesses per search" />
            </div>

            {/* Cost breakdown */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Cost Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                  {[
                    { label: "Business Search", value: fmt$(breakdown.totalBusinessSearch) },
                    { label: "Instant Pages", value: fmt$(breakdown.totalInstantPages) },
                    { label: "Lighthouse", value: fmt$(breakdown.totalLighthouse) },
                    { label: "Cached Hits", value: fmtN(breakdown.totalCachedBusinesses) },
                    { label: "Fresh Fetches", value: fmtN(breakdown.totalFreshBusinesses) },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <p className="text-muted-foreground text-xs">{label}</p>
                      <p className="font-mono font-medium tabular-nums">{value}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </section>

      {/* ── Dev Tools ───────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-base font-semibold mb-3">Dev Tools</h2>
        <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Admin Operations</CardTitle>
            <CardDescription>Backend maintenance and data inspection tools</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Recalculate Business Ranks</p>
                <p className="text-sm text-muted-foreground">Re-run the full scoring algorithm on all cached businesses in Firestore.</p>
              </div>
              <Button variant="outline" onClick={handleRecalculate} disabled={recalculating}>
                <RefreshCw className={`h-4 w-4 mr-2 ${recalculating ? "animate-spin" : ""}`} />
                {recalculating ? "Recalculating…" : "Recalculate"}
              </Button>
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Ghost Businesses</p>
                  <p className="text-sm text-muted-foreground">View cached businesses with legitimacy score ≤ 40</p>
                </div>
                <Button variant="outline" onClick={handleLoadGhosts} disabled={loadingGhosts}>
                  <Ghost className="h-4 w-4 mr-2" />
                  {loadingGhosts ? "Loading…" : ghosts ? "Refresh" : "Load"}
                </Button>
              </div>

              {ghosts !== null && (
                <div className="rounded-lg border">
                  {ghosts.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">No ghost businesses found.</p>
                  ) : (
                    <ScrollArea className="max-h-96">
                      <div className="divide-y">
                        {ghosts.map((biz) => (
                          <div key={biz.cid} className="px-4 py-3 text-sm space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="font-medium">{biz.name}</span>
                              <span className="text-xs font-mono tabular-nums text-red-500">legitimacy: {biz.legitimacyScore ?? 0}</span>
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                              <span>{biz.category}</span>
                              {biz.address && <span>{biz.address}</span>}
                              {biz.phone && <span>{biz.phone}</span>}
                              <span>{biz.reviewCount ?? 0} reviews</span>
                              <span>label: {biz.label}</span>
                              {biz.businessData?.permanentlyClosed && (
                                <span className="text-red-500 font-medium">Permanently Closed</span>
                              )}
                            </div>
                            {biz.legitimacyBreakdown?.reasons && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {biz.legitimacyBreakdown.reasons.map((r, i) => (
                                  <Badge key={i} variant="outline"
                                    className={`text-xs ${r.includes("(-") ? "border-red-500/30 text-red-600 bg-red-500/10" : "border-green-500/30 text-green-600 bg-green-500/10"}`}>
                                    {r}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                  <div className="px-4 py-2 border-t bg-muted/50 text-xs text-muted-foreground">
                    {ghosts.length} ghost business{ghosts.length === 1 ? "" : "es"} found
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        <DevRateLimitTester />
        </div>
      </section>
    </div>
  );
}

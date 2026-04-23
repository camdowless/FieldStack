import { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { recalculateBusinessRank, fetchGhostBusinesses } from "@/lib/api";
import { useAdminStats } from "@/hooks/useAdminStats";
import type { ApiBusiness } from "@/data/leadTypes";
import { ShieldAlert, RefreshCw, Ghost, Flag } from "lucide-react";
import { DevRateLimitTester } from "@/components/DevRateLimitTester";
import { ReportReviewTab } from "@/components/ReportReviewTab";

// Default filter thresholds (mirrors usePreferences DEFAULTS)
const DEFAULT_LEGITIMACY_MIN = 35;
const DEFAULT_OPPORTUNITY_MIN = 25;

function fmt$(n: number) { return n === 0 ? "$0.0000" : `$${n.toFixed(4)}`; }
function fmtN(n: number) { return n.toLocaleString(); }

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
  const {
    totalSearches, totalResultCount, totalDfsCost,
    totalBusinessesIndexed, avgCostPerSearch, avgResultsPerSearch,
    breakdown, highOpportunityCount, pctHighOpportunity, lastUpdated, loading, error,
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
      setRecalculating(false);
    }
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
        const ts = lastUpdated as unknown as { seconds?: number; _seconds?: number } | string;
        const secs = typeof ts === "string" ? Date.parse(ts) / 1000 : (ts.seconds ?? ts._seconds ?? 0);
        const d = new Date(secs * 1000);
        return isNaN(d.getTime()) ? null : d.toLocaleString();
      })()
    : null;

  // Derived cost metrics
  const freshCount = breakdown.totalFreshBusinesses;
  const avgCostPerFreshBusiness = freshCount > 0
    ? (breakdown.totalBusinessSearch + breakdown.totalInstantPages + breakdown.totalLighthouse) / freshCount
    : 0;

  // Avg cost per qualifying lead (businesses passing default legitimacy + opportunity filters)
  // We don't have per-business filter data server-side, so we approximate:
  // avgResultsPerSearch already reflects all returned businesses; we use the ratio of
  // fresh businesses to total results as a proxy for fresh-fetch rate, then apply
  // the filter pass-rate assumption. Since we can't filter server-side here, we surface
  // the raw avg cost per fresh business and note the filter thresholds used.
  const totalFreshCost = breakdown.totalBusinessSearch + breakdown.totalInstantPages + breakdown.totalLighthouse;
  const avgCostPerLead = totalResultCount > 0 ? totalFreshCost / totalResultCount : 0;

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-2 mb-1">
          <ShieldAlert className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">System Admin</h1>
        </div>
        <p className="text-sm text-muted-foreground">Dev tools and platform-wide analytics</p>
      </motion.div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="reports" className="gap-1.5">
            <Flag className="h-3.5 w-3.5" />
            Reports
          </TabsTrigger>
          <TabsTrigger value="devtools">Dev Tools</TabsTrigger>
        </TabsList>

        {/* ── Overview tab ─────────────────────────────────────────────── */}
        <TabsContent value="overview" className="space-y-6 mt-6">
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold">Pricing Tracker</h2>
              {lastUpdatedStr && <span className="text-xs text-muted-foreground">Last updated {lastUpdatedStr}</span>}
            </div>

            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-9 rounded-md" />)}
              </div>
            ) : error ? (
              <p className="text-sm text-destructive">Failed to load stats: {error}</p>
            ) : (
              <div className="space-y-6">
                {/* Volume */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Volume</p>
                  <div className="rounded-lg border px-4">
                    <StatRow label="Total searches" value={fmtN(totalSearches)} sub="all users, all time" />
                    <StatRow label="Total results" value={fmtN(totalResultCount)} sub="businesses analyzed" />
                    <StatRow label="Businesses indexed" value={fmtN(totalBusinessesIndexed)} sub="in Firestore cache" />
                    <StatRow label="Fresh fetches" value={fmtN(freshCount)} sub="not from cache" />
                    <StatRow label="Cached hits" value={fmtN(breakdown.totalCachedBusinesses)} />
                    <StatRow label="Avg results / search" value={avgResultsPerSearch > 0 ? avgResultsPerSearch.toFixed(1) : "—"} />
                    <StatRow
                      label="High opportunity businesses"
                      value={totalBusinessesIndexed > 0 ? `${pctHighOpportunity.toFixed(1)}%` : "—"}
                      sub={`score > 70 · ${fmtN(highOpportunityCount)} of ${fmtN(totalBusinessesIndexed)}`}
                    />
                  </div>
                </div>

                {/* API Costs */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">API Costs (DataForSEO)</p>
                  <div className="rounded-lg border px-4">
                    <StatRow label="Total spend" value={fmt$(totalDfsCost)} sub="all time" />
                    <StatRow label="Business search" value={fmt$(breakdown.totalBusinessSearch)} />
                    <StatRow label="Instant pages" value={fmt$(breakdown.totalInstantPages)} />
                    <StatRow label="Lighthouse" value={fmt$(breakdown.totalLighthouse)} />
                    <StatRow label="Avg cost / search" value={fmt$(avgCostPerSearch)} />
                  </div>
                </div>

                {/* Unit Economics */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Unit Economics</p>
                  <div className="rounded-lg border px-4">
                    <StatRow
                      label="Avg cost / fresh business"
                      value={fmt$(avgCostPerFreshBusiness)}
                      sub="business search + instant pages + lighthouse"
                    />
                    <StatRow
                      label="Avg cost / result (all)"
                      value={fmt$(avgCostPerLead)}
                      sub="total fresh API cost ÷ total results"
                    />
                    <StatRow
                      label="Avg cost / qualifying lead"
                      value={avgCostPerLead > 0 && avgResultsPerSearch > 0
                        ? (() => {
                            // Estimate: assume ~50% of results pass default filters
                            // (legitimacy ≥ 35, opportunity ≥ 25). This is a rough baseline.
                            const estimatedPassRate = 0.5;
                            return fmt$(avgCostPerLead / estimatedPassRate);
                          })()
                        : "—"
                      }
                      sub={`legitimacy ≥ ${DEFAULT_LEGITIMACY_MIN}, opportunity ≥ ${DEFAULT_OPPORTUNITY_MIN} (est. 50% pass rate)`}
                    />
                  </div>
                </div>
              </div>
            )}
          </section>
        </TabsContent>

        {/* ── Reports tab ──────────────────────────────────────────────── */}
        <TabsContent value="reports" className="mt-6">
          <ReportReviewTab />
        </TabsContent>

        {/* ── Dev Tools tab ────────────────────────────────────────────── */}
        <TabsContent value="devtools" className="space-y-4 mt-6">
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
        </TabsContent>
      </Tabs>
    </div>
  );
}

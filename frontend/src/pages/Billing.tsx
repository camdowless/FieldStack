import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle2, Zap, Search, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { useSearchHistory } from "@/hooks/useSearchHistory";
import { useCredits } from "@/hooks/useCredits";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlans } from "@/hooks/usePlans";
import { toast } from "sonner";

type BillingInterval = "monthly" | "annual";

const Billing = () => {
  const { searches, loading: searchesLoading } = useSearchHistory();
  const { remaining, max, used, plan, refreshDate } = useCredits();
  const { user, profile } = useAuth();
  const { plans, loading: plansLoading } = usePlans();
  const [upgradingPriceId, setUpgradingPriceId] = useState<string | null>(null);
  const [managingPortal, setManagingPortal] = useState(false);
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("monthly");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("session_id")) {
      toast.success("Payment successful! Your plan has been upgraded.");
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const totalSpend = searches.reduce((sum, s) => sum + (s.cost?.totalDfs ?? 0), 0);
  const usagePct = max > 0 ? (used / max) * 100 : 0;

  function formatDate(ts: { seconds: number } | null) {
    if (!ts) return "—";
    return new Date(ts.seconds * 1000).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
  }

  async function handleUpgrade(priceId: string) {
    if (upgradingPriceId) return;
    setUpgradingPriceId(priceId);
    try {
      const token = await user?.getIdToken();
      if (!token) { toast.error("Please sign in to upgrade."); return; }
      const res = await fetch("/api/createCheckoutSession", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ priceId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to start checkout. Please try again.");
        return;
      }
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast.error("No checkout URL returned. Please try again.");
      }
    } catch {
      toast.error("Something went wrong. Check your connection and try again.");
    } finally {
      setUpgradingPriceId(null);
    }
  }

  async function handleManageSubscription() {
    if (managingPortal) return;
    setManagingPortal(true);
    try {
      const token = await user?.getIdToken();
      if (!token) { toast.error("Please sign in to manage your subscription."); return; }
      const res = await fetch("/api/createPortalSession", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to open billing portal. Please try again.");
        return;
      }
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast.error("No portal URL returned. Please try again.");
      }
    } catch {
      toast.error("Something went wrong. Check your connection and try again.");
    } finally {
      setManagingPortal(false);
    }
  }

  return (
    <div className="p-6 max-w-4xl">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold mb-6">Billing &amp; Subscription</h1>
      </motion.div>

      <Tabs defaultValue="subscription">
        <TabsList className="mb-6">
          <TabsTrigger value="subscription">Subscription</TabsTrigger>
          <TabsTrigger value="history">Search History</TabsTrigger>
        </TabsList>

        <TabsContent value="subscription">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-primary" /> Credit Usage
                </CardTitle>
                <CardDescription>
                  {remaining} of {max} credits remaining this billing cycle
                  {refreshDate && <span className="ml-1">· refreshes {refreshDate}</span>}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Progress value={usagePct} className="h-2 mb-2" />
                <p className="text-xs text-muted-foreground">
                  {used} credits used · {plan.charAt(0).toUpperCase() + plan.slice(1)} plan
                </p>
              </CardContent>
            </Card>

            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Plans</h2>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1 rounded-lg border p-1 text-sm">
                    <button
                      onClick={() => setBillingInterval("monthly")}
                      className={`px-3 py-1 rounded-md transition-colors ${billingInterval === "monthly" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      Monthly
                    </button>
                    <button
                      onClick={() => setBillingInterval("annual")}
                      className={`px-3 py-1 rounded-md transition-colors flex items-center gap-1.5 ${billingInterval === "annual" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      Annual
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${billingInterval === "annual" ? "bg-white/20" : "bg-green-100 text-green-700"}`}>
                        Save 33%
                      </span>
                    </button>
                  </div>
                  {profile?.subscription.stripeSubscriptionId && (
                    <Button variant="outline" size="sm" onClick={handleManageSubscription} disabled={managingPortal}>
                      {managingPortal && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                      Manage Subscription
                    </Button>
                  )}
                </div>
              </div>
              {plansLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-64 w-full" />)}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {plans.map((p) => {
                    const isCurrent = p.id === plan;
                    const currentIndex = plans.findIndex((pl) => pl.id === plan);
                    const thisIndex = plans.findIndex((pl) => pl.id === p.id);
                    const isDowngrade = thisIndex < currentIndex;
                    const isAnnual = billingInterval === "annual";
                    const activePriceId = isAnnual
                      ? (p.stripePriceIdAnnual ?? p.stripePriceId)
                      : p.stripePriceId;
                    const displayCents = isAnnual && p.annualPriceUsdCents
                      ? Math.round(p.annualPriceUsdCents / 12)
                      : p.priceUsdCents;
                    const priceDisplay = displayCents === 0 ? "Free" : `${(displayCents / 100).toFixed(0)}`;
                    const annualSavings = isAnnual && p.annualPriceUsdCents && p.priceUsdCents > 0
                      ? Math.round((p.priceUsdCents * 12 - p.annualPriceUsdCents) / 100)
                      : null;

                    return (
                      <Card key={p.id} className={isCurrent ? "border-primary ring-1 ring-primary" : ""}>
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-lg">{p.name}</CardTitle>
                            {isCurrent && <Badge>Current</Badge>}
                          </div>
                          <div className="flex items-baseline gap-1">
                            <span className="text-3xl font-bold">{priceDisplay}</span>
                            {displayCents > 0 && <span className="text-muted-foreground text-sm">/mo</span>}
                          </div>
                          {isAnnual && p.annualPriceUsdCents && p.priceUsdCents > 0 && (
                            <p className="text-xs text-muted-foreground">
                              ${(p.annualPriceUsdCents / 100).toFixed(0)}/yr
                              {annualSavings && <span className="text-green-600 font-medium ml-1">· save ${annualSavings}</span>}
                            </p>
                          )}
                        </CardHeader>
                        <CardContent>
                          <ul className="space-y-2 mb-4">
                            {p.features.map((f) => (
                              <li key={f} className="flex items-center gap-2 text-sm">
                                <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                                {f}
                              </li>
                            ))}
                          </ul>
                          <Button
                            variant={isCurrent ? "secondary" : "default"}
                            className="w-full"
                            disabled={isCurrent || isDowngrade || !activePriceId || upgradingPriceId === activePriceId}
                            onClick={() => activePriceId && handleUpgrade(activePriceId)}
                          >
                            {activePriceId && upgradingPriceId === activePriceId ? (
                              <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Redirecting…</>
                            ) : isCurrent ? "Current Plan" : isDowngrade ? "Downgrade" : "Upgrade"}
                          </Button>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5 text-primary" /> Search History
              </CardTitle>
              <CardDescription>
                API cost per search (DataForSEO).{" "}
                {!searchesLoading && searches.length > 0 && (
                  <span>
                    Total across {searches.length} search{searches.length !== 1 ? "es" : ""}:{" "}
                    <strong>${totalSpend.toFixed(4)}</strong>
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {searchesLoading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : searches.length === 0 ? (
                <p className="text-sm text-muted-foreground">No searches yet.</p>
              ) : (
                <div className="space-y-0">
                  {searches.map((s, i) => (
                    <div key={s.id}>
                      <div className="flex items-center justify-between py-3 gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{s.query} — {s.location}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(s.createdAt)} · {s.resultCount ?? 0} results
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          {s.cost?.totalDfs != null ? (
                            <p className="text-sm font-medium">${s.cost.totalDfs.toFixed(4)}</p>
                          ) : (
                            <p className="text-sm text-muted-foreground">—</p>
                          )}
                          {s.cost && (
                            <p className="text-xs text-muted-foreground">
                              {s.cost.cachedBusinesses > 0 && `${s.cost.cachedBusinesses} cached`}
                              {s.cost.cachedBusinesses > 0 && s.cost.freshBusinesses > 0 && " · "}
                              {s.cost.freshBusinesses > 0 && `${s.cost.freshBusinesses} fresh`}
                            </p>
                          )}
                        </div>
                      </div>
                      {i < searches.length - 1 && <Separator />}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Billing;

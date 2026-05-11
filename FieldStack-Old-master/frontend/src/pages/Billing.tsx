import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Zap, Loader2, AlertTriangle, TrendingDown, ArrowDownCircle, Receipt, ExternalLink, Clock } from "lucide-react";
import { RedirectingOverlay } from "@/components/RedirectingOverlay";
import { motion } from "framer-motion";
import { useCredits } from "@/hooks/useCredits";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlans } from "@/hooks/usePlans";
import type { PlanConfig } from "@/lib/planFeatures";
import { toast } from "sonner";

const CANCEL_REASONS = [
  { id: "too_expensive", label: "It's too expensive" },
  { id: "not_using_enough", label: "I'm not using it enough" },
  { id: "missing_features", label: "Missing features I need" },
  { id: "switching_competitor", label: "Switching to a competitor" },
  { id: "temporary_pause", label: "Just need a break, I'll be back" },
  { id: "other", label: "Something else" },
] as const;

type CancelReason = typeof CANCEL_REASONS[number]["id"];

// Step 1 = retention offer, Step 2 = reason + confirm
type CancelStep = 1 | 2;

type BillingInterval = "monthly" | "annual";

interface Invoice {
  id: string;
  number: string | null;
  status: string | null;
  amountPaid: number;
  amountDue: number;
  currency: string;
  created: number;
  periodStart: number;
  periodEnd: number;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  refunded: boolean;
  amountRefunded: number;
}

const Billing = () => {
  const { remaining, max, used, plan, refreshDate } = useCredits();
  const { user, profile } = useAuth();
  const { plans, loading: plansLoading } = usePlans();
  const [upgradingPriceId, setUpgradingPriceId] = useState<string | null>(null);
  const [managingPortal, setManagingPortal] = useState(false);
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("monthly");
  const [redirecting, setRedirecting] = useState<{ show: boolean; destination: string }>({ show: false, destination: "secure checkout" });


  // Invoice history state
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [invoicesLoaded, setInvoicesLoaded] = useState(false);

  // Downgrade confirmation state
  const [downgradeTarget, setDowngradeTarget] = useState<{ plan: PlanConfig; priceId: string } | null>(null);
  const [isDowngrading, setIsDowngrading] = useState(false);

  // Cancel flow state
  const [cancelStep, setCancelStep] = useState<CancelStep>(1);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState<CancelReason | "">("");
  const [cancelReasonOther, setCancelReasonOther] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);
  const [isReactivating, setIsReactivating] = useState(false);

  const cancelAtPeriodEnd = profile?.subscription?.cancelAtPeriodEnd ?? false;
  const periodEnd = profile?.subscription?.currentPeriodEnd as { seconds: number } | null | undefined;
  const subscriptionStatus = profile?.subscription?.status ?? "active";

  // Find the next plan down for the "downgrade instead" offer
  const currentPlanIndex = plans.findIndex((p) => p.id === plan);
  const nextLowerPlan = currentPlanIndex > 1 ? plans[currentPlanIndex - 1] : null;

  function openCancelFlow() {
    setCancelStep(1);
    setCancelReason("");
    setCancelReasonOther("");
    setShowCancelDialog(true);
  }

  function closeCancelFlow() {
    if (isCancelling) return;
    setShowCancelDialog(false);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("session_id")) {
      toast.success("Payment successful! Your plan has been upgraded.");
      window.history.replaceState(null, "", window.location.pathname);
    }
    if (params.has("upgraded")) {
      toast.success("Plan upgraded! You've been charged only the prorated difference.");
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  async function loadInvoices() {
    if (invoicesLoaded || invoicesLoading) return;
    setInvoicesLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch("/api/getInvoices", { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok) {
        setInvoices(data.invoices ?? []);
        setInvoicesLoaded(true);
      } else {
        toast.error(data.error ?? "Failed to load invoices.");
      }
    } catch (err) {
      console.error("[getInvoices]", err);
      toast.error("Failed to load invoices. Check your connection.");
    } finally {
      setInvoicesLoading(false);
    }
  }

  const usagePct = max > 0 ? (used / max) * 100 : 0;

  function formatDate(ts: { seconds: number } | null | undefined) {
    if (!ts) return "—";
    return new Date(ts.seconds * 1000).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
  }

  async function getToken(): Promise<string | null> {
    const token = await user?.getIdToken();
    return token ?? null;
  }

  async function handleUpgrade(priceId: string) {
    if (upgradingPriceId) return;
    setUpgradingPriceId(priceId);
    const hasActiveSub = !!profile?.subscription?.stripeSubscriptionId;
    setRedirecting({ show: true, destination: hasActiveSub ? "Stripe" : "Stripe Checkout" });
    try {
      const token = await getToken();
      if (!token) { setRedirecting({ show: false, destination: "secure checkout" }); toast.error("Please sign in to upgrade."); return; }

      if (hasActiveSub) {
        // Paid → higher paid: open the Stripe portal's upgrade-confirm screen.
        // The portal shows the prorated amount and requires explicit confirmation.
        const res = await fetch("/api/createPortalSession", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ priceId }),
        });
        const data = await res.json();
        if (!res.ok) { setRedirecting({ show: false, destination: "secure checkout" }); toast.error(data.error ?? "Failed to open upgrade page. Please try again."); return; }
        if (data.url) {
          window.location.href = data.url;
        } else {
          setRedirecting({ show: false, destination: "secure checkout" });
          toast.error("No redirect URL returned. Please try again.");
        }
      } else {
        // Free → paid: standard Stripe Checkout
        const res = await fetch("/api/createCheckoutSession", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ priceId }),
        });
        const data = await res.json();
        if (!res.ok) { setRedirecting({ show: false, destination: "secure checkout" }); toast.error(data.error ?? "Failed to start checkout. Please try again."); return; }
        if (data.url) {
          window.location.href = data.url;
        } else {
          setRedirecting({ show: false, destination: "secure checkout" });
          toast.error("No checkout URL returned. Please try again.");
        }
      }
    } catch {
      setRedirecting({ show: false, destination: "secure checkout" });
      toast.error("Something went wrong. Check your connection and try again.");
    } finally {
      setUpgradingPriceId(null);
    }
  }

  async function handleDowngradeConfirm() {
    if (!downgradeTarget) return;
    setIsDowngrading(true);
    setRedirecting({ show: true, destination: "Stripe subscription management" });
    try {
      const token = await getToken();
      if (!token) { setRedirecting({ show: false, destination: "secure checkout" }); toast.error("Please sign in."); return; }
      const res = await fetch("/api/changeSubscription", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) { setRedirecting({ show: false, destination: "secure checkout" }); toast.error(data.error ?? "Failed to open subscription management. Please try again."); return; }
      if (data.url) {
        window.location.href = data.url;
      } else {
        setRedirecting({ show: false, destination: "secure checkout" });
        toast.error("No redirect URL returned. Please try again.");
      }
    } catch {
      setRedirecting({ show: false, destination: "secure checkout" });
      toast.error("Something went wrong. Check your connection and try again.");
    } finally {
      setIsDowngrading(false);
    }
  }

  async function handleManageSubscription() {
    if (managingPortal) return;
    setManagingPortal(true);
    setRedirecting({ show: true, destination: "Stripe billing portal" });
    try {
      const token = await getToken();
      if (!token) { setRedirecting({ show: false, destination: "secure checkout" }); toast.error("Please sign in to manage your subscription."); return; }
      const res = await fetch("/api/createPortalSession", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) { setRedirecting({ show: false, destination: "secure checkout" }); toast.error(data.error ?? "Failed to open billing portal. Please try again."); return; }
      if (data.url) {
        window.location.href = data.url;
      } else {
        setRedirecting({ show: false, destination: "secure checkout" });
        toast.error("No portal URL returned. Please try again.");
      }
    } catch {
      setRedirecting({ show: false, destination: "secure checkout" });
      toast.error("Something went wrong. Check your connection and try again.");
    } finally {
      setManagingPortal(false);
    }
  }

  async function handleCancelConfirm() {
    setIsCancelling(true);
    try {
      const token = await getToken();
      if (!token) { toast.error("Please sign in."); return; }
      const reason = cancelReason === "other" ? cancelReasonOther.trim() || "other" : cancelReason;
      const res = await fetch("/api/cancelSubscription", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Failed to cancel. Please try again."); return; }
      toast.success("Subscription cancelled. You'll keep access until the end of your billing period.");
      setShowCancelDialog(false);
    } catch {
      toast.error("Something went wrong. Check your connection and try again.");
    } finally {
      setIsCancelling(false);
    }
  }

  async function handleReactivate() {
    if (isReactivating) return;
    setIsReactivating(true);
    try {
      const token = await getToken();
      if (!token) { toast.error("Please sign in."); return; }
      const res = await fetch("/api/reactivateSubscription", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Failed to reactivate. Please try again."); return; }
      toast.success("Subscription reactivated. You're all set.");
    } catch {
      toast.error("Something went wrong. Check your connection and try again.");
    } finally {
      setIsReactivating(false);
    }
  }

  return (
    <div className="p-6 max-w-4xl">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold mb-6">Billing &amp; Subscription</h1>
      </motion.div>

      <Tabs defaultValue="subscription" onValueChange={(v) => { if (v === "invoices") loadInvoices(); }}>
        <TabsList className="mb-6">
          <TabsTrigger value="subscription">Subscription</TabsTrigger>
          <TabsTrigger value="invoices">Invoice History</TabsTrigger>
        </TabsList>

        <TabsContent value="subscription">
          <div className="space-y-6">
            {/* Cancellation banner */}
            {cancelAtPeriodEnd && (
              <Card className="border-amber-400 bg-amber-50 dark:bg-amber-950/20">
                <CardContent className="flex items-center justify-between gap-4 py-4">
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
                    <p className="text-sm text-amber-800 dark:text-amber-300">
                      Your subscription is cancelled and will end on {formatDate(periodEnd)}. You'll be moved to the free plan after that.
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={handleReactivate} disabled={isReactivating} className="shrink-0">
                    {isReactivating && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                    Reactivate
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Past-due / payment failed banner */}
            {subscriptionStatus === "past_due" && !cancelAtPeriodEnd && (
              <Card className="border-red-400 bg-red-50 dark:bg-red-950/20">
                <CardContent className="flex items-center justify-between gap-4 py-4">
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-red-800 dark:text-red-300">Payment failed</p>
                      <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">
                        We couldn't charge your card. Update your payment method to keep your plan active.
                      </p>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={handleManageSubscription} disabled={managingPortal} className="shrink-0 border-red-300 text-red-700 hover:bg-red-100">
                    {managingPortal && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                    Update payment
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Trialing banner */}
            {subscriptionStatus === "trialing" && (
              <Card className="border-blue-400 bg-blue-50 dark:bg-blue-950/20">
                <CardContent className="flex items-center gap-3 py-4">
                  <Clock className="h-5 w-5 text-blue-500 shrink-0" />
                  <p className="text-sm text-blue-800 dark:text-blue-300">
                    You're on a free trial
                    {periodEnd ? ` — ends ${formatDate(periodEnd)}` : ""}. No charge until the trial ends.
                  </p>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-primary" /> Credit Usage
                </CardTitle>
                <CardDescription>
                  {plan === "free"
                    ? `${remaining} of ${max} free searches remaining`
                    : <>
                        {remaining} of {max} credits remaining this billing cycle
                        {refreshDate && <span className="ml-1">· refreshes {refreshDate}</span>}
                      </>
                  }
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
                  {profile?.subscription?.stripeSubscriptionId && (
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
                    const priceDisplay = displayCents === 0 ? "Free" : `$${(displayCents / 100).toFixed(0)}`;
                    const annualSavings = isAnnual && p.annualPriceUsdCents && p.priceUsdCents > 0
                      ? Math.round((p.priceUsdCents * 12 - p.annualPriceUsdCents) / 100)
                      : null;

                    // Free plan is a special case — downgrading to free = cancel
                    const isFree = p.priceUsdCents === 0 && !p.stripePriceId;
                    const isDowngradeToFree = isFree && currentIndex > 0;

                    function handlePlanAction() {
                      if (!activePriceId && !isFree) return;
                      if (isDowngradeToFree) {
                        return;
                      } else if (isDowngrade && activePriceId) {
                        setDowngradeTarget({ plan: p, priceId: activePriceId });
                      } else if (activePriceId) {
                        handleUpgrade(activePriceId);
                      }
                    }

                    const isLoading = activePriceId ? upgradingPriceId === activePriceId : false;
                    const isDisabled = isCurrent || isDowngradeToFree || isLoading || (!activePriceId && !isFree);

                    return (
                      <Card key={p.id} className={isCurrent ? "border-primary ring-1 ring-primary" : ""}>
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-lg">{p.name}</CardTitle>
                            {isCurrent && <Badge>{cancelAtPeriodEnd ? "Cancelling" : "Current"}</Badge>}
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
                            variant={isCurrent ? "secondary" : isDowngrade || isDowngradeToFree ? "outline" : "default"}
                            className="w-full"
                            disabled={isDisabled}
                            onClick={handlePlanAction}
                          >
                            {isCurrent ? (cancelAtPeriodEnd ? "Cancelling" : "Current Plan")
                              : isDowngradeToFree ? "Free Plan"
                              : isDowngrade ? "Downgrade"
                              : "Upgrade"}
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

        <TabsContent value="invoices">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5 text-primary" /> Invoice History
              </CardTitle>
              <CardDescription>Past charges and receipts for your subscription.</CardDescription>
            </CardHeader>
            <CardContent>
              {invoicesLoading ? (
                <div className="space-y-0">
                  {[...Array(4)].map((_, i) => (
                    <div key={i}>
                      <div className="flex items-center justify-between py-3 gap-4">
                        <div className="min-w-0 space-y-1.5">
                          <Skeleton className="h-4 w-28" />
                          <Skeleton className="h-3 w-40" />
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right space-y-1.5">
                            <Skeleton className="h-4 w-16 ml-auto" />
                            <Skeleton className="h-4 w-10 ml-auto" />
                          </div>
                          <Skeleton className="h-4 w-4 rounded" />
                        </div>
                      </div>
                      {i < 3 && <Separator />}
                    </div>
                  ))}
                </div>
              ) : invoices.length === 0 ? (
                <p className="text-sm text-muted-foreground">No invoices yet.</p>
              ) : (
                <div className="space-y-0">
                  {invoices.map((inv, i) => {
                    const amount = (inv.amountPaid / 100).toFixed(2);
                    const currency = inv.currency.toUpperCase();
                    const date = new Date(inv.created * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                    const isRefunded = inv.refunded || inv.amountRefunded > 0;
                    return (
                      <div key={inv.id}>
                        <div className="flex items-center justify-between py-3 gap-4">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{date}</p>
                            <p className="text-xs text-muted-foreground">
                              {inv.number ?? inv.id}
                              {isRefunded && <span className="ml-2 text-green-600">· Refunded {inv.amountRefunded > 0 ? `$${(inv.amountRefunded / 100).toFixed(2)}` : ""}</span>}
                            </p>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <div className="text-right">
                              <p className="text-sm font-medium">{currency} ${amount}</p>
                              <Badge variant={inv.status === "paid" ? "secondary" : "destructive"} className="text-xs">
                                {inv.status ?? "unknown"}
                              </Badge>
                            </div>
                            {inv.hostedInvoiceUrl && (
                              <a href={inv.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            )}
                          </div>
                        </div>
                        {i < invoices.length - 1 && <Separator />}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>

      {/* Downgrade confirmation dialog */}
      <AlertDialog open={!!downgradeTarget} onOpenChange={(open) => { if (!open) setDowngradeTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Downgrade to {downgradeTarget?.plan.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Your plan will change at the end of your current billing cycle — no refund will be issued. Until then, you'll keep your current credits and features. After the cycle ends, your plan will switch to {downgradeTarget?.plan.name} with {downgradeTarget?.plan.creditsPerMonth} searches/month.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={handleDowngradeConfirm} disabled={isDowngrading} className="bg-transparent border border-input text-foreground hover:bg-muted shadow-none">
              {isDowngrading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Downgrade
            </AlertDialogAction>
            <AlertDialogCancel disabled={isDowngrading} className="bg-blue-600 text-white hover:bg-blue-700 border-0">Keep current plan</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel flow — multi-step retention dialog */}
      <Dialog open={showCancelDialog} onOpenChange={(open) => { if (!open) closeCancelFlow(); }}>
        <DialogContent className="max-w-md">
          {cancelStep === 1 ? (
            <>
              <DialogHeader>
                <DialogTitle>Before you go…</DialogTitle>
                <DialogDescription>
                  {plan === "free"
                    ? `You still have ${remaining} free search credit${remaining !== 1 ? "s" : ""} remaining.`
                    : <>You still have {remaining} search credit{remaining !== 1 ? "s" : ""} this cycle
                        {refreshDate ? ` — refreshing ${refreshDate}` : ""}.</>
                  }
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 py-2">
                {/* Downgrade offer — only show if there's a lower paid plan */}
                {nextLowerPlan && nextLowerPlan.stripePriceId && (
                  <button
                    onClick={() => {
                      closeCancelFlow();
                      setDowngradeTarget({ plan: nextLowerPlan, priceId: nextLowerPlan.stripePriceId! });
                    }}
                    className="w-full text-left rounded-lg border p-4 hover:border-primary hover:bg-muted/40 transition-colors group"
                  >
                    <div className="flex items-start gap-3">
                      <TrendingDown className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-medium group-hover:text-primary transition-colors">
                          Switch to {nextLowerPlan.name} — ${(nextLowerPlan.priceUsdCents / 100).toFixed(0)}/mo
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Keep {nextLowerPlan.creditsPerMonth} searches/month at a lower cost
                        </p>
                      </div>
                    </div>
                  </button>
                )}

                {/* Always show the "still want to cancel" path */}
                <button
                  onClick={() => setCancelStep(2)}
                  className="w-full text-left rounded-lg border p-4 hover:border-destructive/50 hover:bg-destructive/5 transition-colors group"
                >
                  <div className="flex items-start gap-3">
                    <ArrowDownCircle className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0 group-hover:text-destructive transition-colors" />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground group-hover:text-destructive transition-colors">
                        Cancel my subscription
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Move to the free plan after {formatDate(periodEnd)}
                      </p>
                    </div>
                  </div>
                </button>
              </div>

              <div className="flex justify-end pt-1">
                <Button variant="ghost" size="sm" onClick={closeCancelFlow}>
                  Never mind, keep my plan
                </Button>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Why are you leaving?</DialogTitle>
                <DialogDescription>
                  Your feedback helps us improve. This takes 10 seconds.
                </DialogDescription>
              </DialogHeader>

              <RadioGroup
                value={cancelReason}
                onValueChange={(v) => setCancelReason(v as CancelReason)}
                className="space-y-2 py-2"
              >
                {CANCEL_REASONS.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 rounded-md border px-3 py-2.5 hover:bg-muted/40 transition-colors cursor-pointer">
                    <RadioGroupItem value={r.id} id={r.id} />
                    <Label htmlFor={r.id} className="cursor-pointer text-sm font-normal">{r.label}</Label>
                  </div>
                ))}
              </RadioGroup>

              {cancelReason === "other" && (
                <Textarea
                  placeholder="Tell us more…"
                  value={cancelReasonOther}
                  onChange={(e) => setCancelReasonOther(e.target.value)}
                  className="resize-none text-sm"
                  rows={2}
                />
              )}

              <div className="flex items-center justify-between gap-3 pt-1">
                <Button variant="ghost" size="sm" onClick={() => setCancelStep(1)} disabled={isCancelling}>
                  Back
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={closeCancelFlow} disabled={isCancelling}>
                    Keep my plan
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={!cancelReason || isCancelling}
                    onClick={handleCancelConfirm}
                  >
                    {isCancelling && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                    Confirm cancellation
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <RedirectingOverlay
        show={redirecting.show}
        destination={redirecting.destination}
      />
    </div>
  );
};

export default Billing;

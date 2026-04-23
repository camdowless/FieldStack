import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, CreditCard, Zap, Search } from "lucide-react";
import { motion } from "framer-motion";
import { useSearchHistory } from "@/hooks/useSearchHistory";
import { useCredits } from "@/hooks/useCredits";
import { Skeleton } from "@/components/ui/skeleton";

const PLAN_DETAILS = [
  { id: "free", name: "Free", price: 0, features: ["100 lead lookups/mo", "Basic analysis"] },
  { id: "starter", name: "Starter", price: 29, features: ["500 lead lookups/mo", "Basic analysis", "Email templates"] },
  { id: "pro", name: "Pro", price: 79, features: ["2,000 lead lookups/mo", "Full analysis suite", "AI scripts & prompts", "CSV export", "Priority support"] },
  { id: "enterprise", name: "Enterprise", price: 199, features: ["10,000 lead lookups/mo", "Everything in Pro", "Team seats (up to 5)", "White-label reports", "API access"] },
];

const invoices = [
  { date: "Apr 1, 2026", amount: "$79.00", status: "Paid" },
  { date: "Mar 1, 2026", amount: "$79.00", status: "Paid" },
  { date: "Feb 1, 2026", amount: "$79.00", status: "Paid" },
  { date: "Jan 1, 2026", amount: "$79.00", status: "Paid" },
];

const Billing = () => {
  const { searches, loading: searchesLoading } = useSearchHistory();
  const { remaining, max, used, plan } = useCredits();

  const totalSpend = searches.reduce((sum, s) => sum + (s.cost?.totalDfs ?? 0), 0);
  const usagePct = max > 0 ? (used / max) * 100 : 0;

  function formatDate(ts: { seconds: number } | null) {
    if (!ts) return "—";
    return new Date(ts.seconds * 1000).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
  }

  return (
    <div className="p-6 max-w-4xl">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold mb-6">Billing & Subscription</h1>
      </motion.div>

      <div className="space-y-6">
        {/* Search usage */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5 text-primary" /> Search Usage
            </CardTitle>
            <CardDescription>
              API cost per search (DataForSEO).{" "}
              {!searchesLoading && searches.length > 0 && (
                <span>Total across {searches.length} search{searches.length !== 1 ? "es" : ""}: <strong>${totalSpend.toFixed(4)}</strong></span>
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
                        <p className="text-xs text-muted-foreground">{formatDate(s.createdAt)} · {s.resultCount ?? 0} results</p>
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

        {/* Current usage */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" /> Credit Usage
            </CardTitle>
            <CardDescription>{remaining} of {max} credits remaining this billing cycle</CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={usagePct} className="h-2 mb-2" />
            <p className="text-xs text-muted-foreground">{used} credits used · {plan.charAt(0).toUpperCase() + plan.slice(1)} plan</p>
          </CardContent>
        </Card>

        {/* Plans */}
        <div>
          <h2 className="text-lg font-semibold mb-4">Plans</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {PLAN_DETAILS.map((p) => {
              const isCurrent = p.id === plan;
              return (
                <Card key={p.id} className={isCurrent ? "border-primary ring-1 ring-primary" : ""}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{p.name}</CardTitle>
                      {isCurrent && <Badge>Current</Badge>}
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-bold">{p.price === 0 ? "Free" : `$${p.price}`}</span>
                      {p.price > 0 && <span className="text-muted-foreground text-sm">/mo</span>}
                    </div>
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
                    <Button variant={isCurrent ? "secondary" : "default"} className="w-full" disabled={isCurrent}>
                      {isCurrent ? "Current Plan" : "Upgrade"}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Payment method */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" /> Payment Method
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-8 w-12 bg-muted rounded flex items-center justify-center text-xs font-bold">VISA</div>
              <div>
                <p className="text-sm font-medium">•••• •••• •••• 4242</p>
                <p className="text-xs text-muted-foreground">Expires 12/2027</p>
              </div>
            </div>
            <Button variant="outline" size="sm">Update</Button>
          </CardContent>
        </Card>

        {/* Invoices */}
        <Card>
          <CardHeader>
            <CardTitle>Invoice History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-0">
              {invoices.map((inv, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-medium">{inv.date}</p>
                      <p className="text-xs text-muted-foreground">Pro Plan — Monthly</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">{inv.amount}</span>
                      <Badge variant="secondary" className="text-xs">{inv.status}</Badge>
                      <Button variant="ghost" size="sm">Download</Button>
                    </div>
                  </div>
                  {i < invoices.length - 1 && <Separator />}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Billing;

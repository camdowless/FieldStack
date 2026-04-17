import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, CreditCard, Zap } from "lucide-react";
import { motion } from "framer-motion";

const plans = [
  { name: "Starter", price: 29, credits: 50, features: ["50 lead lookups/mo", "Basic analysis", "Email templates"] },
  { name: "Pro", price: 79, credits: 200, features: ["200 lead lookups/mo", "Full analysis suite", "AI scripts & prompts", "CSV export", "Priority support"], current: true },
  { name: "Agency", price: 199, credits: 1000, features: ["1,000 lead lookups/mo", "Everything in Pro", "Team seats (up to 5)", "White-label reports", "API access"] },
];

const invoices = [
  { date: "Apr 1, 2026", amount: "$79.00", status: "Paid" },
  { date: "Mar 1, 2026", amount: "$79.00", status: "Paid" },
  { date: "Feb 1, 2026", amount: "$79.00", status: "Paid" },
  { date: "Jan 1, 2026", amount: "$79.00", status: "Paid" },
];

const Billing = () => {
  return (
    <div className="p-6 max-w-4xl">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold mb-6">Billing & Subscription</h1>
      </motion.div>

      <div className="space-y-6">
        {/* Current usage */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" /> Credit Usage
            </CardTitle>
            <CardDescription>142 of 200 credits remaining this billing cycle</CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={29} className="h-2 mb-2" />
            <p className="text-xs text-muted-foreground">58 credits used • Resets Apr 30, 2026</p>
          </CardContent>
        </Card>

        {/* Plans */}
        <div>
          <h2 className="text-lg font-semibold mb-4">Plans</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map((plan) => (
              <Card key={plan.name} className={plan.current ? "border-primary ring-1 ring-primary" : ""}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{plan.name}</CardTitle>
                    {plan.current && <Badge>Current</Badge>}
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-bold">${plan.price}</span>
                    <span className="text-muted-foreground text-sm">/mo</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 mb-4">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Button variant={plan.current ? "secondary" : "default"} className="w-full" disabled={plan.current}>
                    {plan.current ? "Current Plan" : "Upgrade"}
                  </Button>
                </CardContent>
              </Card>
            ))}
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

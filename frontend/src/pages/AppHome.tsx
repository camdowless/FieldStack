import { Link } from "react-router-dom";
import { useCredits } from "@/hooks/useCredits";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Zap, CreditCard } from "lucide-react";

export default function AppHome() {
  const { profile } = useAuth();
  const { remaining, max, used, plan, refreshDate } = useCredits();
  const pct = max > 0 ? (used / max) * 100 : 0;

  const displayName = profile?.displayName ?? "there";

  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Welcome back, {displayName}</h1>
        <p className="text-muted-foreground mt-1">You're on the <span className="font-medium capitalize">{plan}</span> plan.</p>
      </div>

      {/* Credit usage card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" /> Credit Usage
          </CardTitle>
          <CardDescription>
            {remaining} of {max} credits remaining this period
            {refreshDate && <> · Refreshes {refreshDate}</>}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Progress value={pct} className="h-2" />
          {remaining === 0 && (
            <Button size="sm" asChild>
              <Link to="/billing"><CreditCard className="h-4 w-4 mr-2" /> Upgrade for more credits</Link>
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Build your product here */}
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-base">Your product goes here</CardTitle>
          <CardDescription>
            This is the main app screen. Replace this card with your product's core UI.
            The auth, billing, and credit system are all wired up and ready to go.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

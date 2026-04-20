import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/hooks/use-toast";
import { usePreferences } from "@/hooks/usePreferences";
import { motion } from "framer-motion";
import { recalculateBusinessRank, fetchGhostBusinesses } from "@/lib/api";
import type { ApiBusiness } from "@/data/leadTypes";
import { useState } from "react";

const Settings = () => {
  const [recalculating, setRecalculating] = useState(false);
  const [loadingGhosts, setLoadingGhosts] = useState(false);
  const [ghosts, setGhosts] = useState<ApiBusiness[] | null>(null);
  const { prefs, update } = usePreferences();

  const handleSave = () => {
    toast({ title: "Settings saved", description: "Your changes have been saved." });
  };

  const handleRecalculate = async () => {
    setRecalculating(true);
    try {
      const result = await recalculateBusinessRank();
      toast({
        title: "Business ranks recalculated",
        description: `Processed ${result.processed} businesses, updated ${result.updated}.`,
        duration: Infinity,
      });
    } catch (err) {
      toast({
        title: "Recalculation failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
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
      toast({
        title: "Failed to load ghost businesses",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoadingGhosts(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold mb-6">Account Settings</h1>
      </motion.div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Manage your account details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input id="firstName" defaultValue="John" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input id="lastName" defaultValue="Doe" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" defaultValue="john@example.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="company">Company / Agency Name</Label>
              <Input id="company" defaultValue="Doe Web Services" />
            </div>
            <Button onClick={handleSave}>Save Changes</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Password</CardTitle>
            <CardDescription>Update your password</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current Password</Label>
              <Input id="currentPassword" type="password" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <Input id="newPassword" type="password" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm New Password</Label>
              <Input id="confirmPassword" type="password" />
            </div>
            <Button onClick={handleSave}>Update Password</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Search Preferences</CardTitle>
            <CardDescription>Control which businesses appear in your search results</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Opportunity Score Minimum</Label>
                <span className="text-sm font-mono tabular-nums font-medium">{prefs.opportunityScoreMin}</span>
              </div>
              <Slider
                min={0}
                max={100}
                step={5}
                value={[prefs.opportunityScoreMin]}
                onValueChange={([v]) => update({ opportunityScoreMin: v })}
                aria-label="Opportunity score minimum"
              />
              <p className="text-xs text-muted-foreground">
                Hides businesses with an opportunity score below this value. Lower means you'll see more results including businesses with decent websites. Higher means only businesses with clear website problems.
              </p>
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Legitimacy Score Minimum</Label>
                <span className="text-sm font-mono tabular-nums font-medium">{prefs.legitimacyScoreMin}</span>
              </div>
              <Slider
                min={0}
                max={100}
                step={5}
                value={[prefs.legitimacyScoreMin]}
                onValueChange={([v]) => update({ legitimacyScoreMin: v })}
                aria-label="Legitimacy score minimum"
              />
              <p className="text-xs text-muted-foreground">
                Filters out likely ghost businesses — listings with no reviews, no photos, unclaimed profiles, or other signs they may not be operating. Higher means stricter filtering, lower means more results but more noise.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dev Tools</CardTitle>
            <CardDescription>Admin operations for development</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Recalculate Business Ranks</p>
                <p className="text-sm text-muted-foreground">
                  Re-run the full scoring algorithm on all cached businesses in Firestore.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={handleRecalculate}
                disabled={recalculating}
              >
                {recalculating ? "Recalculating…" : "Recalculate"}
              </Button>
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Ghost Businesses</p>
                  <p className="text-sm text-muted-foreground">
                    View cached businesses with legitimacy score ≤ 40
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={handleLoadGhosts}
                  disabled={loadingGhosts}
                >
                  {loadingGhosts ? "Loading…" : ghosts ? "Refresh" : "Load"}
                </Button>
              </div>

              {ghosts !== null && (
                <div className="rounded-lg border">
                  {ghosts.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">No ghost businesses found.</p>
                  ) : (
                    <div className="max-h-96 overflow-y-auto divide-y">
                      {ghosts.map((biz) => (
                        <div key={biz.cid} className="px-4 py-3 text-sm space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{biz.name}</span>
                            <span className="text-xs font-mono tabular-nums text-red-500">
                              legitimacy: {biz.legitimacyScore ?? 0}
                            </span>
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
                                <span
                                  key={i}
                                  className={`text-xs px-1.5 py-0.5 rounded ${
                                    r.includes("(-") ? "bg-red-500/10 text-red-600" : "bg-green-500/10 text-green-600"
                                  }`}
                                >
                                  {r}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="px-4 py-2 border-t bg-muted/50 text-xs text-muted-foreground">
                    {ghosts.length} ghost business{ghosts.length === 1 ? "" : "es"} found
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
};

export default Settings;

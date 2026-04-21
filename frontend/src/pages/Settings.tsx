import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/hooks/use-toast";
import { usePreferences } from "@/hooks/usePreferences";
import { motion } from "framer-motion";

const Settings = () => {
  const { prefs, update } = usePreferences();

  const handleSave = () => {
    toast({ title: "Settings saved", description: "Your changes have been saved." });
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

      </div>
    </div>
  );
};

export default Settings;

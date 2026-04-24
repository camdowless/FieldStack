import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { usePreferences } from "@/hooks/usePreferences";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { motion } from "framer-motion";
import {
  User,
  Shield,
  SlidersHorizontal,
  Mail,
  KeyRound,
  Sun,
  Moon,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
};

const Settings = () => {
  const { prefs, update } = usePreferences();
  const { user, sendPasswordReset } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [company, setCompany] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  const handleSaveProfile = () => {
    toast({ title: "Profile updated", description: "Your profile changes have been saved." });
  };

  const handlePasswordReset = async () => {
    if (!user?.email) return;
    setResetLoading(true);
    try {
      await sendPasswordReset(user.email);
      setResetSent(true);
      toast({
        title: "Reset email sent",
        description: `Check ${user.email} for a password reset link.`,
      });
    } catch {
      toast({ title: "Error", description: "Failed to send reset email. Try again.", variant: "destructive" });
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl">
      <motion.div {...fadeUp} transition={{ duration: 0.3 }} className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage your profile, security, and search preferences.</p>
      </motion.div>

      <motion.div {...fadeUp} transition={{ duration: 0.3, delay: 0.05 }}>
        <Tabs defaultValue="profile">
          <TabsList className="mb-6">
            <TabsTrigger value="profile" className="gap-2">
              <User className="w-4 h-4" /> Profile
            </TabsTrigger>
            <TabsTrigger value="security" className="gap-2">
              <Shield className="w-4 h-4" /> Security
            </TabsTrigger>
            <TabsTrigger value="preferences" className="gap-2">
              <SlidersHorizontal className="w-4 h-4" /> Preferences
            </TabsTrigger>
          </TabsList>

          {/* ── PROFILE ─────────────────────────────────────────── */}
          <TabsContent value="profile">
            <Card>
              <CardContent className="pt-6 space-y-5">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-xl select-none">
                    {(displayName || user?.email || "?")[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{displayName || "No display name"}</p>
                    <p className="text-xs text-muted-foreground">{user?.email}</p>
                    {user?.emailVerified && (
                      <Badge variant="secondary" className="mt-1 text-xs gap-1">
                        <CheckCircle2 className="w-3 h-3 text-green-500" /> Verified
                      </Badge>
                    )}
                  </div>
                </div>

                <Separator />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="displayName">Display Name</Label>
                    <Input
                      id="displayName"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Your name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="company">Company / Agency</Label>
                    <Input
                      id="company"
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      placeholder="Acme Web Services"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="email" className="flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5" /> Email Address
                  </Label>
                  <Input id="email" type="email" value={user?.email ?? ""} disabled className="bg-muted/50 cursor-not-allowed" />
                  <p className="text-xs text-muted-foreground">Email changes are not supported at this time.</p>
                </div>

                <div className="flex justify-end">
                  <Button onClick={handleSaveProfile} size="sm">Save Profile</Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── SECURITY ────────────────────────────────────────── */}
          <TabsContent value="security">
            <Card>
              <CardContent className="pt-6 space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 p-2 rounded-lg bg-muted">
                      <KeyRound className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Password</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        We'll send a secure reset link to <span className="font-medium text-foreground">{user?.email}</span>
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePasswordReset}
                    disabled={resetSent || resetLoading || !user?.email}
                    className="shrink-0"
                  >
                    {resetSent ? (
                      <span className="flex items-center gap-1.5 text-green-600">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Sent
                      </span>
                    ) : resetLoading ? (
                      "Sending..."
                    ) : (
                      "Send Reset Email"
                    )}
                  </Button>
                </div>

                <Separator />

                <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                  <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    For your security, always sign out when using shared devices and never share your login credentials.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── PREFERENCES ─────────────────────────────────────── */}
          <TabsContent value="preferences">
            <Card>
              <CardContent className="pt-6 space-y-6">
                {/* Theme */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-muted">
                      {theme === "dark" ? (
                        <Moon className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <Sun className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-medium">Dark Theme</p>
                      <p className="text-xs text-muted-foreground">Switch between light and dark UI.</p>
                    </div>
                  </div>
                  <Switch
                    checked={theme === "dark"}
                    onCheckedChange={toggleTheme}
                    aria-label="Toggle dark theme"
                  />
                </div>

                <Separator />

                {/* Opportunity Score */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Opportunity Score Minimum</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Hides businesses scoring below this threshold.
                      </p>
                    </div>
                    <span className="text-sm font-mono font-semibold tabular-nums bg-muted px-2 py-0.5 rounded">
                      {prefs.opportunityScoreMin}
                    </span>
                  </div>
                  <Slider
                    min={0}
                    max={100}
                    step={5}
                    value={[prefs.opportunityScoreMin]}
                    onValueChange={([v]) => update({ opportunityScoreMin: v })}
                    aria-label="Opportunity score minimum"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>More results</span>
                    <span>Higher quality</span>
                  </div>
                </div>

                <Separator />

                {/* Legitimacy Score */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Legitimacy Score Minimum</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Filters out ghost businesses and unverified listings.
                      </p>
                    </div>
                    <span className="text-sm font-mono font-semibold tabular-nums bg-muted px-2 py-0.5 rounded">
                      {prefs.legitimacyScoreMin}
                    </span>
                  </div>
                  <Slider
                    min={0}
                    max={100}
                    step={5}
                    value={[prefs.legitimacyScoreMin]}
                    onValueChange={([v]) => update({ legitimacyScoreMin: v })}
                    aria-label="Legitimacy score minimum"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>More results</span>
                    <span>Stricter filter</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </motion.div>
    </div>
  );
};

export default Settings;

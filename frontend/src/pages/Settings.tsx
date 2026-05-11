import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  Trash2,
} from "lucide-react";

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
};

const Settings = () => {
  const { prefs, update } = usePreferences();
  const { user, profile, sendPasswordReset, deleteAccount, updateProfile } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [company, setCompany] = useState(profile?.company ?? "");
  const [saveLoading, setSaveLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  // Keep local fields in sync if the Firestore profile snapshot updates
  useEffect(() => {
    setDisplayName(profile?.displayName ?? user?.displayName ?? "");
    setCompany(profile?.company ?? "");
  }, [profile, user]);

  const isGoogleAccount = user?.providerData?.some((p) => p.providerId === "google.com") ?? false;

  // Delete account flow — two-step confirmation
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteStep, setDeleteStep] = useState<1 | 2>(1);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const DELETE_CONFIRM_PHRASE = "delete my account";

  const handleSaveProfile = async () => {
    setSaveLoading(true);
    try {
      await updateProfile({ displayName: displayName.trim(), company: company.trim() });
      toast({ title: "Profile updated", description: "Your profile changes have been saved." });
    } catch (err) {
      console.error("[Settings] Failed to save profile:", err);
      toast({ title: "Error", description: "Failed to save profile. Please try again.", variant: "destructive" });
    } finally {
      setSaveLoading(false);
    }
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

  const handleDeleteAccount = async () => {
    if (deleteConfirmText.trim().toLowerCase() !== DELETE_CONFIRM_PHRASE) return;
    setIsDeleting(true);
    try {
      await deleteAccount();
      // deleteAccount signs the user out and redirects — no further action needed here.
    } catch {
      toast({
        title: "Deletion failed",
        description: "Something went wrong. Please try again or contact support.",
        variant: "destructive",
      });
      setIsDeleting(false);
    }
  };

  const openDeleteDialog = () => {
    setDeleteStep(1);
    setDeleteConfirmText("");
    setShowDeleteDialog(true);
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
                  <Button onClick={handleSaveProfile} size="sm" disabled={saveLoading}>
                    {saveLoading ? "Saving…" : "Save Profile"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── SECURITY ────────────────────────────────────────── */}
          <TabsContent value="security">
            <Card>
              <CardContent className="pt-6 space-y-5">
                {/* Password reset */}
                <div className={`flex items-start justify-between gap-4 ${isGoogleAccount ? "opacity-50" : ""}`}>
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 p-2 rounded-lg bg-muted">
                      <KeyRound className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Password Reset</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {isGoogleAccount
                          ? "Your account is connected through Google — no password to manage."
                          : resetSent
                          ? <>Check <span className="font-medium text-foreground">{user?.email}</span> — a reset link is on its way. Follow the link in the email to set a new password.</>
                          : <>To change your password, we'll send a reset link to <span className="font-medium text-foreground">{user?.email}</span>. Click the link in that email to set a new password.</>
                        }
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePasswordReset}
                    disabled={isGoogleAccount || resetSent || resetLoading || !user?.email}
                    className="shrink-0"
                  >
                    {resetSent ? (
                      <span className="flex items-center gap-1.5 text-green-600">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Email sent
                      </span>
                    ) : resetLoading ? (
                      "Sending..."
                    ) : (
                      "Send Reset Email"
                    )}
                  </Button>
                </div>

                <Separator />

                {/* Delete account */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 p-2 rounded-lg bg-destructive/10">
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Delete Account</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Permanently removes your account and all associated data. This cannot be undone.
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={openDeleteDialog}
                    className="shrink-0"
                  >
                    Delete Account
                  </Button>
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

                {/* Items per page */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Items Per Page</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        How many items to show per page.
                      </p>
                    </div>
                    <span className="text-sm font-mono font-semibold tabular-nums bg-muted px-2 py-0.5 rounded">
                      {prefs.itemsPerPage}
                    </span>
                  </div>
                  <Slider
                    min={5}
                    max={100}
                    step={5}
                    value={[prefs.itemsPerPage]}
                    onValueChange={([v]) => update({ itemsPerPage: v })}
                    aria-label="Items per page"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Fewer</span>
                    <span>More</span>
                  </div>
                </div>

                {/* Add your app-specific preferences here */}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </motion.div>

      {/* ── DELETE ACCOUNT DIALOG ──────────────────────────────── */}
      <AlertDialog open={showDeleteDialog} onOpenChange={(open) => { if (!isDeleting) setShowDeleteDialog(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" />
              {deleteStep === 1 ? "Are you sure?" : "Confirm deletion"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                {deleteStep === 1 ? (
                  <>
                    <p>Deleting your account will permanently remove:</p>
                    <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                      <li>Your profile and account credentials</li>
                      <li>All search history and saved leads</li>
                      <li>Your active subscription (no refund)</li>
                      <li>All billing and usage data</li>
                    </ul>
                    <p className="font-medium text-foreground">This action is irreversible.</p>
                  </>
                ) : (
                  <>
                    <p>
                      Type <span className="font-mono font-semibold text-foreground">{DELETE_CONFIRM_PHRASE}</span> to confirm.
                    </p>
                    <Input
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder={DELETE_CONFIRM_PHRASE}
                      autoFocus
                      aria-label="Type to confirm account deletion"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && deleteConfirmText.trim().toLowerCase() === DELETE_CONFIRM_PHRASE) {
                          handleDeleteAccount();
                        }
                      }}
                    />
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            {deleteStep === 1 ? (
              <Button
                variant="destructive"
                onClick={() => setDeleteStep(2)}
              >
                Continue
              </Button>
            ) : (
              <Button
                variant="destructive"
                disabled={deleteConfirmText.trim().toLowerCase() !== DELETE_CONFIRM_PHRASE || isDeleting}
                onClick={handleDeleteAccount}
              >
                {isDeleting ? "Deleting…" : "Delete my account"}
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Settings;

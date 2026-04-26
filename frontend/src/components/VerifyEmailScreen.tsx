import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Search, Mail, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

export function VerifyEmailScreen() {
  const { user, resendVerificationEmail, refreshEmailVerified, logout } = useAuth();
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [checking, setChecking] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const sentRef = useRef(false);

  // Auto-send once on mount
  useEffect(() => {
    if (sentRef.current) return;
    sentRef.current = true;
    handleResend();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Poll every 4s — when the user clicks the link in their inbox,
  // reload() will return emailVerified=true and we update context state directly,
  // lifting the gate without requiring a page refresh.
  useEffect(() => {
    const interval = setInterval(async () => {
      await refreshEmailVerified();
    }, 4000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleResend = async () => {
    setResending(true);
    setErrorMsg("");
    try {
      await resendVerificationEmail();
      setResent(true);
      setCooldown(60);
      toast.success("Verification email sent — check your inbox.");
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (msg.includes("Too many attempts") || msg.includes("resource-exhausted") || msg.includes("429")) {
        const notice = "Firebase rate-limited this email address. Wait ~10 minutes and try again.";
        setErrorMsg(notice);
        toast.error(notice);
      } else {
        toast.error("Couldn't send the email. Please try again.");
      }
    } finally {
      setResending(false);
    }
  };

  const handleCheckNow = async () => {
    setChecking(true);
    try {
      await refreshEmailVerified();
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm text-center space-y-6">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg gradient-bg">
            <Search className="h-4 w-4 text-white" />
          </div>
          <span className="text-xl font-bold">
            Gimme<span className="gradient-text">Leads</span>
          </span>
        </div>

        {/* Icon */}
        <div className="flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Mail className="h-8 w-8 text-primary" />
          </div>
        </div>

        {/* Copy */}
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">Check your inbox</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            We sent a verification link to{" "}
            <span className="font-medium text-foreground">{user?.email}</span>.
            Click it to activate your account.
          </p>
        </div>

        {/* Auto-detecting notice */}
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Waiting for verification…
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <Button
            className="w-full"
            variant="outline"
            onClick={handleCheckNow}
            disabled={checking}
          >
            {checking ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
            I've verified — continue
          </Button>

          <Button
            className="w-full"
            variant="ghost"
            onClick={handleResend}
            disabled={resending || cooldown > 0}
          >
            {resending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {cooldown > 0 ? `Resend available in ${cooldown}s` : resent ? "Resend email" : "Send verification email"}
          </Button>

          {errorMsg && (
            <p className="text-xs text-amber-600 dark:text-amber-400 text-center">{errorMsg}</p>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Wrong email?{" "}
          <button
            className="underline underline-offset-4 hover:text-foreground"
            onClick={logout}
          >
            Sign out
          </button>
        </p>
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { auth } from "@/lib/firebase";
import { verifyPasswordResetCode } from "firebase/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, Eye, EyeOff, CheckCircle2, ShieldCheck, XCircle, Loader2 } from "lucide-react";
import { motion } from "framer-motion";

type Stage = "loading" | "reset-form" | "reset-success" | "verify-success" | "error";

// Password strength helpers
function getStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { score, label: "Weak", color: "bg-red-500" };
  if (score <= 2) return { score, label: "Fair", color: "bg-amber-500" };
  if (score <= 3) return { score, label: "Good", color: "bg-yellow-400" };
  return { score, label: "Strong", color: "bg-emerald-500" };
}

export default function AuthAction() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { confirmPasswordReset, applyActionCode, logout } = useAuth();

  const mode = searchParams.get("mode");
  const oobCode = searchParams.get("oobCode") ?? "";

  const [stage, setStage] = useState<Stage>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [resetEmail, setResetEmail] = useState("");

  // Reset form state
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const strength = getStrength(password);

  useEffect(() => {
    if (!oobCode) {
      setErrorMsg("Invalid or missing action code.");
      setStage("error");
      return;
    }
    if (mode === "resetPassword") {
      verifyPasswordResetCode(auth, oobCode)
        .then((email) => {
          setResetEmail(email);
          setStage("reset-form");
        })
        .catch(() => {
          setErrorMsg("This reset link has expired or already been used.");
          setStage("error");
        });
    } else if (mode === "verifyEmail") {
      applyActionCode(oobCode)
        .then(() => setStage("verify-success"))
        .catch((err: any) => {
          const code: string = err?.code ?? "";
          if (code === "auth/invalid-action-code" || code === "auth/expired-action-code") {
            setErrorMsg("This verification link has expired or already been used.");
          } else {
            setErrorMsg("Something went wrong. Please try again.");
          }
          setStage("error");
        });
    } else {
      setErrorMsg("Unknown action type.");
      setStage("error");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (password.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setFormError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await confirmPasswordReset(oobCode, password);
      setStage("reset-success");
    } catch (err: any) {
      const code: string = err?.code ?? "";
      if (code === "auth/expired-action-code" || code === "auth/invalid-action-code") {
        setFormError("This reset link has expired. Please request a new one.");
      } else if (code === "auth/weak-password") {
        setFormError("Password is too weak. Try a longer or more complex password.");
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <motion.div
        key={stage}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="w-full max-w-sm"
      >
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg gradient-bg">
            <Search className="h-4 w-4 text-white" />
          </div>
          <span className="text-xl font-bold">
            Gimme<span className="gradient-text">Leads</span>
          </span>
        </div>

        {/* ── LOADING ── */}
        {stage === "loading" && (
          <div className="flex flex-col items-center gap-4 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground text-sm">Verifying…</p>
          </div>
        )}

        {/* ── RESET FORM ── */}
        {stage === "reset-form" && (
          <div className="space-y-6">
            <div className="flex justify-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <ShieldCheck className="h-7 w-7 text-primary" />
              </div>
            </div>
            <div className="text-center space-y-1">
              <h1 className="text-2xl font-bold">Set a new password</h1>
              <p className="text-muted-foreground text-sm">
                Choose something strong — at least 8 characters.
              </p>
            </div>

            <form onSubmit={handleReset} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="reset-email-display">Email</Label>
                <Input
                  id="reset-email-display"
                  type="email"
                  value={resetEmail}
                  disabled
                  className="h-11 bg-muted text-muted-foreground cursor-not-allowed"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-password">New password</Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showPw ? "text" : "password"}
                    placeholder="Min. 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    className="h-11 pr-10"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPw((v) => !v)}
                    tabIndex={-1}
                    aria-label={showPw ? "Hide password" : "Show password"}
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>

                {/* Strength meter */}
                {password.length > 0 && (
                  <div className="space-y-1 pt-1">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4].map((i) => (
                        <div
                          key={i}
                          className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                            strength.score >= i ? strength.color : "bg-muted"
                          }`}
                        />
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Strength: <span className="font-medium text-foreground">{strength.label}</span>
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type={showPw ? "text" : "password"}
                  placeholder="Re-enter password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="h-11"
                />
                {confirm.length > 0 && password !== confirm && (
                  <p className="text-xs text-destructive">Passwords don't match</p>
                )}
                {confirm.length > 0 && password === confirm && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Passwords match
                  </p>
                )}
              </div>

              {formError && <p className="text-sm text-destructive">{formError}</p>}

              <Button
                type="submit"
                className="w-full h-11 font-semibold"
                disabled={submitting || password.length < 8 || password !== confirm}
              >
                {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                {submitting ? "Updating…" : "Update password"}
              </Button>
            </form>
          </div>
        )}

        {/* ── RESET SUCCESS ── */}
        {stage === "reset-success" && (
          <div className="space-y-6 text-center">
            <div className="flex justify-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
                <CheckCircle2 className="h-7 w-7 text-emerald-500" />
              </div>
            </div>
            <div className="space-y-1">
              <h1 className="text-2xl font-bold">Password updated</h1>
              <p className="text-muted-foreground text-sm">
                Your password has been changed. Sign in with your new credentials.
              </p>
            </div>
            <Button className="w-full h-11 font-semibold" onClick={async () => {
              await logout();
              navigate("/");
            }}>
              Sign in
            </Button>
          </div>
        )}

        {/* ── VERIFY SUCCESS ── */}
        {stage === "verify-success" && (
          <div className="space-y-6 text-center">
            <div className="flex justify-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
                <CheckCircle2 className="h-7 w-7 text-emerald-500" />
              </div>
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold">Email verified</h1>
              <p className="text-muted-foreground text-sm">
                You're all set. Head back to the original tab to continue.
              </p>
            </div>
          </div>
        )}

        {/* ── ERROR ── */}
        {stage === "error" && (
          <div className="space-y-6 text-center">
            <div className="flex justify-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
                <XCircle className="h-7 w-7 text-destructive" />
              </div>
            </div>
            <div className="space-y-1">
              <h1 className="text-2xl font-bold">Link expired</h1>
              <p className="text-muted-foreground text-sm">{errorMsg}</p>
            </div>
            <Button variant="outline" className="w-full h-11" onClick={() => navigate("/")}>
              Back to sign in
            </Button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

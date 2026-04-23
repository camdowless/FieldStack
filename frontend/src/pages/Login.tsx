import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Search, MapPin, TrendingUp, Star, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { motion } from "framer-motion";

type View = "signup" | "login" | "forgot" | "forgot-sent";

const FEATURES = [
  { icon: Search, text: "Find businesses with weak online presence" },
  { icon: TrendingUp, text: "AI-scored leads ranked by opportunity" },
  { icon: MapPin, text: "Search any city, zip code, or radius" },
  { icon: Star, text: "Save and track your best prospects" },
];

export default function Login() {
  const { signIn, signUp, signInWithGoogle, sendPasswordReset, resendVerificationEmail } = useAuth();
  const [searchParams] = useSearchParams();

  const [view, setView] = useState<View>(() =>
    searchParams.get("mode") === "login" ? "login" : "signup"
  );

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [loading, setLoading] = useState(false);

  // Sync view if URL param changes
  useEffect(() => {
    const mode = searchParams.get("mode");
    if (mode === "login") setView("login");
    else if (mode === "signup") setView("signup");
  }, [searchParams]);

  const clearForm = () => {
    setEmail("");
    setPassword("");
    setConfirm("");
    setError("");
    setWarning("");
    setShowPassword(false);
  };

  const switchView = (v: View) => {
    clearForm();
    setView(v);
  };

  const handleGoogle = async () => {
    setError("");
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      if (err?.code !== "auth/popup-closed-by-user") {
        setError("Google sign-in failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setWarning("");
    setLoading(true);
    try {
      const result = await signIn(email, password);
      if (result.needsVerification) {
        setWarning("Your email isn't verified yet. Check your inbox, or resend below.");
      }
    } catch (err: any) {
      const code = err?.code as string | undefined;
      if (
        code === "auth/invalid-credential" ||
        code === "auth/wrong-password" ||
        code === "auth/user-not-found"
      ) {
        setError("Invalid email or password.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      await signUp(email, password);
    } catch (err: any) {
      const code = err?.code as string | undefined;
      if (code === "auth/email-already-in-use") {
        setError("An account with this email already exists.");
      } else if (code === "auth/weak-password") {
        setError("Password must be at least 6 characters.");
      } else if (code === "auth/invalid-email") {
        setError("Please enter a valid email address.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await sendPasswordReset(resetEmail);
      setView("forgot-sent");
    } catch (err: any) {
      const code = err?.code as string | undefined;
      if (code === "auth/invalid-email") {
        setError("Please enter a valid email address.");
      } else {
        setView("forgot-sent");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* ── Left panel: value prop (hidden on mobile) ── */}
      <div className="hidden lg:flex lg:w-[52%] gradient-bg flex-col justify-between p-12 text-white relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-white/20 blur-3xl" />
          <div className="absolute bottom-[-10%] left-[-10%] w-[400px] h-[400px] rounded-full bg-white/10 blur-3xl" />
        </div>

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/20">
            <Search className="h-4.5 w-4.5 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight">GimmeLeads</span>
        </div>

        {/* Main copy */}
        <div className="relative z-10 space-y-8">
          <div>
            <h1 className="text-4xl font-bold leading-tight mb-4">
              Find your next client<br />in 60 seconds.
            </h1>
            <p className="text-white/75 text-lg leading-relaxed">
              Search any city or zip code. We analyze thousands of businesses and surface the ones that need your services most.
            </p>
          </div>

          <div className="space-y-4">
            {FEATURES.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 shrink-0">
                  <Icon className="h-4 w-4 text-white" />
                </div>
                <span className="text-white/90 text-sm font-medium">{text}</span>
              </div>
            ))}
          </div>

          {/* Social proof */}
          <div className="flex items-center gap-3 pt-2">
            <div className="flex -space-x-2">
              {["bg-pink-400", "bg-amber-400", "bg-emerald-400", "bg-sky-400"].map((c, i) => (
                <div key={i} className={`h-8 w-8 rounded-full ${c} border-2 border-white/30 flex items-center justify-center text-xs font-bold text-white`}>
                  {["J", "M", "R", "S"][i]}
                </div>
              ))}
            </div>
            <p className="text-white/75 text-sm">
              Join <span className="text-white font-semibold">500+</span> freelancers finding clients
            </p>
          </div>
        </div>

        {/* Bottom badge */}
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm text-white/90">
            <CheckCircle2 className="h-4 w-4 text-white" />
            Free to start · No credit card required
          </div>
        </div>
      </div>

      {/* ── Right panel: auth form ── */}
      <div className="flex-1 flex items-center justify-center p-6 bg-background">
        <motion.div
          key={view}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="w-full max-w-sm"
        >
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center justify-center gap-2 mb-8">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg gradient-bg">
              <Search className="h-4 w-4 text-white" />
            </div>
            <span className="text-xl font-bold">
              Gimme<span className="gradient-text">Leads</span>
            </span>
          </div>

          {/* ── SIGNUP VIEW ── */}
          {view === "signup" && (
            <div className="space-y-5">
              <div className="space-y-1">
                <h2 className="text-2xl font-bold">Start for free</h2>
                <p className="text-muted-foreground text-sm">No credit card required. 3 free searches included.</p>
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full h-11 gap-2 font-medium"
                onClick={handleGoogle}
                disabled={loading}
              >
                <GoogleIcon />
                Continue with Google
              </Button>

              <div className="flex items-center gap-2">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground px-1">or</span>
                <Separator className="flex-1" />
              </div>

              <form onSubmit={handleSignUp} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    className="h-11"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="signup-password">Password</Label>
                  <div className="relative">
                    <Input
                      id="signup-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Min. 6 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={6}
                      autoComplete="new-password"
                      className="h-11 pr-10"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowPassword((v) => !v)}
                      tabIndex={-1}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="signup-confirm">Confirm password</Label>
                  <Input
                    id="signup-confirm"
                    type={showPassword ? "text" : "password"}
                    placeholder="Re-enter password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    minLength={6}
                    autoComplete="new-password"
                    className="h-11"
                  />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full h-11 font-semibold" disabled={loading}>
                  {loading ? "Creating account…" : "Create free account"}
                </Button>
              </form>

              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <button
                  type="button"
                  className="text-primary font-medium hover:underline underline-offset-4"
                  onClick={() => switchView("login")}
                >
                  Sign in
                </button>
              </p>
              <p className="text-center text-xs text-muted-foreground">
                By signing up, you agree to our{" "}
                <a href="https://gimmeleads.io/tos.html" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-foreground">Terms</a>
                {" "}and{" "}
                <a href="https://gimmeleads.io/privacy.html" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-foreground">Privacy Policy</a>.
              </p>
            </div>
          )}

          {/* ── LOGIN VIEW ── */}
          {view === "login" && (
            <div className="space-y-5">
              <div className="space-y-1">
                <h2 className="text-2xl font-bold">Welcome back</h2>
                <p className="text-muted-foreground text-sm">Sign in to your account to continue.</p>
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full h-11 gap-2 font-medium"
                onClick={handleGoogle}
                disabled={loading}
              >
                <GoogleIcon />
                Continue with Google
              </Button>

              <div className="flex items-center gap-2">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground px-1">or</span>
                <Separator className="flex-1" />
              </div>

              <form onSubmit={handleSignIn} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    className="h-11"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="login-password">Password</Label>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-primary underline-offset-4 hover:underline"
                      onClick={() => switchView("forgot")}
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <Input
                      id="login-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={6}
                      autoComplete="current-password"
                      className="h-11 pr-10"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowPassword((v) => !v)}
                      tabIndex={-1}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                {warning && (
                  <p className="text-sm text-yellow-600 dark:text-yellow-400">
                    {warning}{" "}
                    <button
                      type="button"
                      className="underline underline-offset-4 hover:opacity-80"
                      onClick={async () => {
                        await resendVerificationEmail();
                        setWarning("Verification email sent. Check your inbox.");
                      }}
                    >
                      Resend email
                    </button>
                  </p>
                )}
                <Button type="submit" className="w-full h-11 font-semibold" disabled={loading}>
                  {loading ? "Signing in…" : "Sign in"}
                </Button>
              </form>

              <p className="text-center text-sm text-muted-foreground">
                Don't have an account?{" "}
                <button
                  type="button"
                  className="text-primary font-medium hover:underline underline-offset-4"
                  onClick={() => switchView("signup")}
                >
                  Sign up free
                </button>
              </p>
            </div>
          )}

          {/* ── FORGOT PASSWORD VIEW ── */}
          {view === "forgot" && (
            <div className="space-y-5">
              <div className="space-y-1">
                <h2 className="text-2xl font-bold">Reset your password</h2>
                <p className="text-muted-foreground text-sm">
                  Enter your email and we'll send you a reset link.
                </p>
              </div>
              <form onSubmit={handlePasswordReset} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="reset-email">Email</Label>
                  <Input
                    id="reset-email"
                    type="email"
                    placeholder="you@example.com"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    required
                    autoComplete="email"
                    className="h-11"
                  />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full h-11 font-semibold" disabled={loading}>
                  {loading ? "Sending…" : "Send reset link"}
                </Button>
              </form>
              <p className="text-center">
                <button
                  type="button"
                  className="text-sm text-muted-foreground hover:text-primary underline-offset-4 hover:underline"
                  onClick={() => switchView("login")}
                >
                  Back to sign in
                </button>
              </p>
            </div>
          )}

          {/* ── FORGOT SENT VIEW ── */}
          {view === "forgot-sent" && (
            <div className="space-y-5 text-center">
              <div className="flex justify-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                  <CheckCircle2 className="h-7 w-7 text-primary" />
                </div>
              </div>
              <div className="space-y-1">
                <h2 className="text-2xl font-bold">Check your email</h2>
                <p className="text-muted-foreground text-sm">
                  If an account exists for{" "}
                  <span className="font-medium text-foreground">{resetEmail}</span>,
                  you'll receive a reset link shortly.
                </p>
              </div>
              <Button
                variant="outline"
                className="w-full h-11"
                onClick={() => switchView("login")}
              >
                Back to sign in
              </Button>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

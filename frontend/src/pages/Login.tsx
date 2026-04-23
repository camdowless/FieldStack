import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Search } from "lucide-react";
import { SignUpModal } from "@/components/SignUpModal";

type View = "login" | "forgot" | "forgot-sent";

export default function Login() {
  const { signIn, signInWithGoogle, sendPasswordReset, resendVerificationEmail } = useAuth();
  const [view, setView] = useState<View>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [loading, setLoading] = useState(false);
  const [signUpOpen, setSignUpOpen] = useState(false);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setWarning("");
    setLoading(true);
    try {
      const result = await signIn(email, password);
      if (result.needsVerification) {
        setWarning("Your email isn't verified yet. Check your inbox, or resend the verification email.");
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

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await sendPasswordReset(resetEmail);
      setView("forgot-sent");
    } catch (err: any) {
      const code = err?.code as string | undefined;
      // Don't reveal whether the email exists — show success either way
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
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg gradient-bg">
              <Search className="h-5 w-5 text-white" />
            </div>
          </div>
          <CardTitle className="text-xl">
            Gimme<span className="gradient-text">Leads</span>
          </CardTitle>
          <CardDescription>
            {view === "login" && "Sign in to your account"}
            {view === "forgot" && "Reset your password"}
            {view === "forgot-sent" && "Check your email"}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {view === "login" && (
            <div className="space-y-4">
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                onClick={handleGoogle}
                disabled={loading}
              >
                <GoogleIcon />
                Continue with Google
              </Button>
              <div className="flex items-center gap-2">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground">or</span>
                <Separator className="flex-1" />
              </div>
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-primary underline-offset-4 hover:underline"
                      onClick={() => { setError(""); setView("forgot"); }}
                    >
                      Forgot password?
                    </button>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    autoComplete="current-password"
                  />
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
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Please wait…" : "Sign in"}
                </Button>
              </form>
              <div className="text-center text-sm text-muted-foreground">
                Don't have an account?{" "}
                <button
                  type="button"
                  className="text-primary underline-offset-4 hover:underline"
                  onClick={() => setSignUpOpen(true)}
                >
                  Sign up
                </button>
              </div>
            </div>
          )}

          {view === "forgot" && (
            <form onSubmit={handlePasswordReset} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Enter your email and we'll send you a reset link.
              </p>
              <div className="space-y-2">
                <Label htmlFor="reset-email">Email</Label>
                <Input
                  id="reset-email"
                  type="email"
                  placeholder="you@example.com"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Sending…" : "Send reset link"}
              </Button>
              <div className="text-center">
                <button
                  type="button"
                  className="text-sm text-muted-foreground hover:text-primary underline-offset-4 hover:underline"
                  onClick={() => { setError(""); setView("login"); }}
                >
                  Back to sign in
                </button>
              </div>
            </form>
          )}

          {view === "forgot-sent" && (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                If an account exists for <span className="font-medium text-foreground">{resetEmail}</span>,
                you'll receive a password reset link shortly.
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => { setError(""); setView("login"); }}
              >
                Back to sign in
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <SignUpModal open={signUpOpen} onOpenChange={setSignUpOpen} />
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

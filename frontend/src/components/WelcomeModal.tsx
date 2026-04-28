import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Star, ArrowRight, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useCredits } from "@/hooks/useCredits";

const WELCOME_KEY = (uid: string) => `saas-welcomed-${uid}`;

export function WelcomeModal() {
  const { user, profile, loading } = useAuth();
  const { max } = useCredits();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (loading || !user || !profile) return;

    const key = WELCOME_KEY(user.uid);
    if (localStorage.getItem(key)) return;

    const createdAt = (profile.createdAt as { seconds?: number } | null)?.seconds;
    if (createdAt) {
      const ageMs = Date.now() - createdAt * 1000;
      if (ageMs > 5 * 60 * 1000) {
        localStorage.setItem(key, "1");
        return;
      }
    }

    setOpen(true);
  }, [loading, user, profile]);

  function handleClose() {
    if (user) localStorage.setItem(WELCOME_KEY(user.uid), "1");
    setOpen(false);
  }

  const credits = max || 10;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden gap-0">
        <div className="gradient-bg px-6 py-8 text-white text-center">
          <div className="flex justify-center mb-3">
            <div className="h-14 w-14 rounded-2xl bg-white/20 flex items-center justify-center">
              <Zap className="h-7 w-7 text-white" />
            </div>
          </div>
          <h2 className="text-2xl font-bold mb-1">Welcome aboard!</h2>
          <p className="text-white/80 text-sm">Your account is ready to go.</p>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="flex items-start gap-3 rounded-lg bg-muted/60 p-4">
            <Zap className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold">You have {credits} free credits</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Credits are used when you take actions in the app. Upgrade anytime for more.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
            <Star className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">Need more? Upgrade anytime.</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Paid plans give you more credits and access to premium features.
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 pb-6 flex flex-col gap-2">
          <Button variant="outline" className="w-full gap-2" onClick={handleClose}>
            Get started <ArrowRight className="h-4 w-4" />
          </Button>
          <Button size="sm" className="w-full" asChild>
            <Link to="/billing" onClick={handleClose}>View plans &amp; pricing</Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Zap, Star, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useCredits } from "@/hooks/useCredits";

const WELCOME_KEY = (uid: string) => `gimmeleads-welcomed-${uid}`;

export function WelcomeModal() {
  const { user, profile, loading } = useAuth();
  const { max } = useCredits();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (loading || !user || !profile) return;

    const key = WELCOME_KEY(user.uid);
    if (localStorage.getItem(key)) return;

    // Only show for genuinely new accounts (created within last 5 minutes)
    const createdAt = (profile.createdAt as { seconds?: number } | null)?.seconds;
    if (createdAt) {
      const ageMs = Date.now() - createdAt * 1000;
      if (ageMs > 5 * 60 * 1000) {
        // Existing user who hasn't seen the modal — still show once
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

  const credits = max || 3;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden gap-0">
        {/* Header gradient */}
        <div className="gradient-bg px-6 py-8 text-white text-center">
          <div className="flex justify-center mb-3">
            <div className="h-14 w-14 rounded-2xl bg-white/20 flex items-center justify-center">
              <Search className="h-7 w-7 text-white" />
            </div>
          </div>
          <h2 className="text-2xl font-bold mb-1">Welcome to GimmeLeads</h2>
          <p className="text-white/80 text-sm">Your lead generation engine is ready.</p>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Free credits callout */}
          <div className="flex items-start gap-3 rounded-lg bg-muted/60 p-4">
            <Zap className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold">You have {credits} free search credits</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Search any city or zip code to find businesses that need your services. Larger searches may use more credits. These don't expire or reset.
              </p>
            </div>
          </div>

          {/* What you can do */}
          <div className="space-y-2.5">
            {[
              "Find businesses with weak online presence",
              "See lead scores ranked by opportunity",
              "Save your best leads for follow-up",
            ].map((item) => (
              <div key={item} className="flex items-center gap-2.5 text-sm">
                <div className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                {item}
              </div>
            ))}
          </div>

          {/* Upgrade nudge */}
          <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
            <Star className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">Need more? Upgrade anytime.</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Pro plans start at $19/mo for 30 searches/month. No commitment required.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex flex-col gap-2">
          <Button variant="outline" className="w-full gap-2" onClick={handleClose}>
            Start Searching <ArrowRight className="h-4 w-4" />
          </Button>
          <Button size="sm" className="w-full bg-blue-600 hover:bg-blue-700 text-white" asChild>
            <Link to="/billing" onClick={handleClose}>
              View plans &amp; pricing
            </Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

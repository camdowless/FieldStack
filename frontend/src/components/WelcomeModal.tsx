import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { config } from "@/lib/config";

const WELCOME_KEY = (uid: string) => `app-welcomed-${uid}`;

export function WelcomeModal() {
  const { user, profile, loading } = useAuth();
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

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden gap-0">
        {/* Header */}
        <div className="gradient-bg px-6 py-8 text-white text-center">
          <div className="flex justify-center mb-3">
            <div className="h-14 w-14 rounded-2xl bg-white/20 flex items-center justify-center text-white font-bold text-2xl">
              {config.appName[0]}
            </div>
          </div>
          <h2 className="text-2xl font-bold mb-1">Welcome to {config.appName}</h2>
          <p className="text-white/80 text-sm">Your account is ready.</p>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <div className="space-y-2.5">
            {[
              "Explore the app and get familiar with the features",
              "Update your profile in Settings",
              "Upgrade your plan in Billing when you're ready",
            ].map((item) => (
              <div key={item} className="flex items-center gap-2.5 text-sm">
                <div className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                {item}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex flex-col gap-2">
          <Button variant="outline" className="w-full gap-2" onClick={handleClose}>
            Get Started <ArrowRight className="h-4 w-4" />
          </Button>
          <Button size="sm" className="w-full" asChild>
            <Link to="/billing" onClick={handleClose}>
              View plans &amp; pricing
            </Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

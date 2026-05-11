import { useState } from "react";
import { motion } from "framer-motion";
import { Building2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { provisionCompany } from "@/lib/fieldstackApi";
import { useToast } from "@/hooks/use-toast";

export function CompanySetupScreen() {
  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = companyName.trim();
    if (!name || name.length < 2) return;

    setLoading(true);
    try {
      await provisionCompany(name);
      // AuthContext will pick up the companyId update via the existing onSnapshot
      // on /users/{uid} — no manual state change needed here.
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      toast({ title: "Setup failed", description: msg, variant: "destructive" });
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background overflow-hidden">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <motion.div
          animate={{ scale: [1, 1.15, 1], opacity: [0.18, 0.28, 0.18] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full bg-primary/20 blur-[120px]"
        />
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.12, 0.22, 0.12] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut", delay: 2 }}
          className="absolute -bottom-32 -right-32 w-[500px] h-[500px] rounded-full bg-violet-500/15 blur-[120px]"
        />
      </div>

      <div className="relative z-10 w-full max-w-sm px-6">
        {/* Icon */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="flex justify-center mb-8"
        >
          <div className="relative">
            <motion.div
              animate={{ scale: [1, 1.35, 1], opacity: [0.4, 0, 0.4] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
              className="absolute inset-0 rounded-2xl bg-primary/30"
            />
            <div className="relative w-16 h-16 rounded-2xl gradient-bg flex items-center justify-center shadow-lg shadow-primary/30">
              <Building2 className="w-8 h-8 text-white" />
            </div>
          </div>
        </motion.div>

        {/* Headline */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="text-center mb-8"
        >
          <h1 className="text-2xl font-bold tracking-tight mb-1.5">Set up your workspace</h1>
          <p className="text-sm text-muted-foreground">
            What's the name of your company? You can always change this later.
          </p>
        </motion.div>

        {/* Form */}
        <motion.form
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          onSubmit={handleSubmit}
          className="rounded-2xl border bg-card/60 backdrop-blur-sm shadow-xl shadow-black/5 p-6 flex flex-col gap-5"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="company-name">Company name</Label>
            <Input
              id="company-name"
              placeholder="Acme Cabinets & Countertops"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              disabled={loading}
              autoFocus
              maxLength={200}
            />
          </div>

          <Button
            type="submit"
            disabled={loading || companyName.trim().length < 2}
            className="w-full"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Creating workspace…
              </>
            ) : (
              "Continue"
            )}
          </Button>
        </motion.form>
      </div>
    </div>
  );
}

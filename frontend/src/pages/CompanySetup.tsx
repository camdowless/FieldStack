/**
 * CompanySetup — shown to new users who have no company yet.
 * Creates a company + seeds default lead times.
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { createCompanyWithMember } from "@/contexts/CompanyContext";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export default function CompanySetup() {
  const { user, profile } = useAuth();
  const [companyName, setCompanyName] = useState("");
  const [yourName, setYourName] = useState(profile?.displayName ?? user?.displayName ?? "");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!companyName.trim() || !yourName.trim()) return;
    if (!user) return;

    setLoading(true);
    try {
      await createCompanyWithMember({
        uid: user.uid,
        email: user.email ?? "",
        name: yourName.trim(),
        companyName: companyName.trim(),
        companySlug: slugify(companyName),
      });
      toast.success("Company created! Welcome to FieldStack.");
    } catch (err) {
      console.error(err);
      toast.error("Failed to create company. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-primary text-primary-foreground font-bold text-2xl mb-4">
            F
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Welcome to FieldStack</h1>
          <p className="text-muted-foreground text-sm mt-2">
            Set up your company to get started with schedule intelligence.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create your company</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="yourName">Your name</Label>
                <Input
                  id="yourName"
                  value={yourName}
                  onChange={(e) => setYourName(e.target.value)}
                  placeholder="Jane Smith"
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="companyName">Company name</Label>
                <Input
                  id="companyName"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Acme Cabinets & Countertops"
                  required
                />
                {companyName && (
                  <p className="text-xs text-muted-foreground">
                    Slug: <span className="font-mono">{slugify(companyName)}</span>
                  </p>
                )}
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={loading || !companyName.trim() || !yourName.trim()}
              >
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create Company
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

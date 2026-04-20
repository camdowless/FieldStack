import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";
import { getBusinessById } from "@/lib/businessCache";
import { fetchBusinessesByCids } from "@/lib/api";
import { normalizeBusiness } from "@/data/leadTypes";
import type { Business } from "@/data/mockBusinesses";
import { LeadDetailPanel } from "@/components/LeadDetailPanel";

interface LeadDetailSheetProps {
  cid: string | null;
  onClose: () => void;
}

export function LeadDetailSheet({ cid, onClose }: LeadDetailSheetProps) {
  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!cid) {
      setBusiness(null);
      return;
    }

    // Try in-memory cache first
    const cached = getBusinessById(cid);
    if (cached) {
      setBusiness(cached);
      return;
    }

    // Fetch from Firestore businesses cache via API
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchBusinessesByCids([cid])
      .then((res) => {
        if (cancelled) return;
        if (res.results.length > 0) {
          setBusiness(normalizeBusiness(res.results[0]));
        } else {
          setError("Business data no longer available.");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message ?? "Failed to load business details.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [cid]);

  return (
    <Sheet open={!!cid} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full sm:max-w-2xl p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>{business?.name ?? "Lead Details"}</SheetTitle>
          <SheetDescription>Detailed view of the selected lead</SheetDescription>
        </SheetHeader>
        <ScrollArea className="h-full p-6">
          {loading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
          {error && (
            <div className="text-center py-20 text-muted-foreground">{error}</div>
          )}
          {business && !loading && <LeadDetailPanel business={business} onUpdate={setBusiness} />}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

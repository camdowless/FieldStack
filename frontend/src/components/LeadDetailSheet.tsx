import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { getBusinessById } from "@/lib/businessCache";
import { fetchBusinessesByCids } from "@/lib/api";
import { normalizeBusiness } from "@/data/leadTypes";
import type { Business } from "@/data/mockBusinesses";
import { LeadDetailPanel } from "@/components/LeadDetailPanel";
import { ResizableSheet } from "@/components/ResizableSheet";

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
    <ResizableSheet
      open={!!cid}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={business?.name ?? "Lead Details"}
      description="Detailed view of the selected lead"
    >
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}
      {error && (
        <div className="text-center py-20 text-muted-foreground">{error}</div>
      )}
      {business && !loading && <LeadDetailPanel business={business} onUpdate={setBusiness} />}
    </ResizableSheet>
  );
}

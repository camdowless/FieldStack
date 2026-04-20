import { useState } from "react";
import { Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { submitReport, type ReportReason } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface ReportDialogProps {
  cid: string;
  businessName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const REASONS: { value: ReportReason; label: string }[] = [
  { value: "wrong_ranking", label: "Mistaken ranking / score" },
  { value: "wrong_signal", label: "Incorrect signal or flag" },
  { value: "incorrect_info", label: "Wrong business information" },
  { value: "other", label: "Other" },
];

export function ReportDialog({ cid, businessName, open, onOpenChange }: ReportDialogProps) {
  const [reason, setReason] = useState<ReportReason | "">("");
  const [details, setDetails] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async () => {
    if (!reason) return;
    setLoading(true);
    try {
      await submitReport({ cid, businessName, reason, details: details.trim() || undefined });
      toast({ title: "Report submitted", description: "Thanks for the feedback." });
      onOpenChange(false);
      setReason("");
      setDetails("");
    } catch {
      toast({ title: "Failed to submit report", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Report an issue</DialogTitle>
          <DialogDescription>
            Flag a problem with <span className="font-medium text-foreground">{businessName}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as ReportReason)}>
              <SelectTrigger id="reason">
                <SelectValue placeholder="Select a reason…" />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="details">Details <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea
              id="details"
              placeholder="Describe the issue…"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={1000}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!reason || loading}>
            {loading ? "Submitting…" : "Submit report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReportButton({ cid, businessName }: { cid: string; businessName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 text-muted-foreground hover:text-destructive"
        onClick={(e) => { e.preventDefault(); setOpen(true); }}
        title="Report an issue"
      >
        <Flag className="h-4 w-4" />
      </Button>
      <ReportDialog cid={cid} businessName={businessName} open={open} onOpenChange={setOpen} />
    </>
  );
}

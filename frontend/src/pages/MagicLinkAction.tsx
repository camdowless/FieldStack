/**
 * MagicLinkAction — one-click task completion from email links.
 * No login required — the JWT token in the URL is the auth.
 * Route: /tasks/action?token=...
 */

import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, AlertCircle, XCircle } from "lucide-react";
import { format } from "date-fns";
import { STEP_TYPE_LABELS } from "@/types/fieldstack";

interface StepInfo {
  stepType: string;
  building?: string | null;
  floor?: string | null;
  dueDate?: string | null;
  projectName: string;
  assignedTo?: string | null;
  status: string;
  notes?: string | null;
}

export default function MagicLinkAction() {
  const [params] = useSearchParams();
  const token = params.get("token");

  const [stepInfo, setStepInfo] = useState<StepInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [doneAction, setDoneAction] = useState<"complete" | "block" | null>(null);

  useEffect(() => {
    if (!token) {
      setError("No token provided.");
      setLoading(false);
      return;
    }

    fetch(`/api/magic-link?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setStepInfo(data);
        }
      })
      .catch(() => setError("Failed to load task info."))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleAction(action: "complete" | "block") {
    if (!token) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action, note: note.trim() || undefined }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setDone(true);
        setDoneAction(action);
      }
    } catch {
      setError("Failed to update task. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 pb-8 text-center">
            <XCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
            <h2 className="text-lg font-semibold mb-2">Link Error</h2>
            <p className="text-sm text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 pb-8 text-center">
            {doneAction === "complete" ? (
              <>
                <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-emerald-500" />
                <h2 className="text-lg font-semibold mb-2">Task Marked Complete</h2>
                <p className="text-sm text-muted-foreground">
                  {STEP_TYPE_LABELS[stepInfo?.stepType as keyof typeof STEP_TYPE_LABELS] ?? stepInfo?.stepType} for {stepInfo?.projectName} has been marked complete.
                </p>
              </>
            ) : (
              <>
                <AlertCircle className="h-12 w-12 mx-auto mb-4 text-yellow-500" />
                <h2 className="text-lg font-semibold mb-2">Task Marked Blocked</h2>
                <p className="text-sm text-muted-foreground">
                  The task has been flagged as blocked. Your supervisor will be notified.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!stepInfo) return null;

  const stepLabel = STEP_TYPE_LABELS[stepInfo.stepType as keyof typeof STEP_TYPE_LABELS] ?? stepInfo.stepType;
  const location = [stepInfo.building, stepInfo.floor].filter(Boolean).join(" / ") || "General";
  const dueDate = stepInfo.dueDate ? format(new Date(stepInfo.dueDate), "MMM d, yyyy") : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2 mb-1">
            <div className="text-xs font-mono text-primary uppercase tracking-wider">FieldStack</div>
          </div>
          <CardTitle className="text-lg">{stepLabel}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Project</span>
              <span className="font-medium">{stepInfo.projectName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Location</span>
              <span className="font-medium">{location}</span>
            </div>
            {stepInfo.assignedTo && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Assigned to</span>
                <span className="font-medium">{stepInfo.assignedTo}</span>
              </div>
            )}
            {dueDate && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Due date</span>
                <span className="font-medium">{dueDate}</span>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="note">Add a note (optional)</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Any notes about this task..."
              rows={3}
            />
          </div>

          <div className="flex gap-3">
            <Button
              className="flex-1 gap-2"
              onClick={() => handleAction("complete")}
              disabled={submitting}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Mark Complete
            </Button>
            <Button
              variant="outline"
              className="gap-2 text-yellow-600 border-yellow-400/40"
              onClick={() => handleAction("block")}
              disabled={submitting}
            >
              <AlertCircle className="h-4 w-4" />
              Blocked
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

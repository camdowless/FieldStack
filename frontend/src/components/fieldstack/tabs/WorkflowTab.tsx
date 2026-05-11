/**
 * WorkflowTab — 6-step task chain per building/floor.
 * Shop Drawings → Submissions → Order Materials → Confirm Delivery → Install → Punch List
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, Clock, AlertCircle, Circle } from "lucide-react";
import { toast } from "sonner";
import { Timestamp } from "firebase/firestore";
import { format } from "date-fns";
import type { TaskStep, TeamMember } from "@/types/fieldstack";
import { STEP_TYPE_LABELS } from "@/types/fieldstack";

const STEP_ORDER = ["SHOP_DRAWINGS", "SUBMISSIONS", "ORDER_MATERIALS", "CONFIRM_DELIVERY", "INSTALL", "PUNCH_LIST"] as const;

function statusIcon(status: string) {
  if (status === "COMPLETE") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === "IN_PROGRESS") return <Clock className="h-4 w-4 text-blue-500" />;
  if (status === "BLOCKED") return <AlertCircle className="h-4 w-4 text-red-500" />;
  return <Circle className="h-4 w-4 text-muted-foreground" />;
}

function statusBadge(status: string) {
  if (status === "COMPLETE") return <Badge variant="outline" className="text-emerald-600 border-emerald-400/40 text-[10px]">Complete</Badge>;
  if (status === "IN_PROGRESS") return <Badge variant="secondary" className="text-blue-600 border-blue-400/40 text-[10px]">In Progress</Badge>;
  if (status === "BLOCKED") return <Badge variant="destructive" className="text-[10px]">Blocked</Badge>;
  return <Badge variant="outline" className="text-muted-foreground text-[10px]">Pending</Badge>;
}

interface Props {
  projectId: string;
  steps: TaskStep[];
  team: TeamMember[];
}

export function WorkflowTab({ projectId, steps, team }: Props) {
  // Group steps by building/floor
  const groups: Record<string, TaskStep[]> = {};
  for (const s of steps) {
    const key = [s.building, s.floor].filter(Boolean).join(" / ") || "General";
    if (!groups[key]) groups[key] = [];
    groups[key].push(s);
  }

  if (steps.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <div className="text-3xl mb-3 opacity-40">🔧</div>
          <p className="text-sm text-muted-foreground">No workflow steps yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Upload a schedule to auto-generate task chains.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-1">Task Workflow</h3>
        <p className="text-xs text-muted-foreground">
          6-step chain per building/floor: Shop Drawings → Submissions → Order → Confirm Delivery → Install → Punch List
        </p>
      </div>

      {Object.entries(groups).map(([groupKey, groupSteps]) => (
        <Card key={groupKey}>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-mono">{groupKey}</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="space-y-2">
              {STEP_ORDER.map((stepType, idx) => {
                const step = groupSteps.find((s) => s.stepType === stepType);
                if (!step) return null;
                const dueDate = step.dueDate instanceof Timestamp ? format(step.dueDate.toDate(), "MMM d") : null;
                const assignee = team.find((m) => m.id === step.assignedToId);

                return (
                  <div key={stepType} className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono w-4 shrink-0">
                      {idx + 1}
                    </div>
                    {statusIcon(step.status)}
                    <div className="flex-1 min-w-0">
                      <span className="text-sm">{STEP_TYPE_LABELS[stepType]}</span>
                      {step.notes && (
                        <span className="text-xs text-muted-foreground ml-2 truncate">{step.notes}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {assignee && (
                        <span className="text-xs text-muted-foreground font-mono">{assignee.name}</span>
                      )}
                      {dueDate && (
                        <span className="text-xs text-muted-foreground font-mono">{dueDate}</span>
                      )}
                      {statusBadge(step.status)}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

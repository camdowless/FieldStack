/**
 * TimelineTab — all tasks sorted by install date, filterable by our tasks vs all.
 */

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Timestamp } from "firebase/firestore";
import { format } from "date-fns";
import type { Task } from "@/types/fieldstack";
import { TASK_CATEGORY_LABELS } from "@/types/fieldstack";

interface Props {
  tasks: Task[];
}

export function TimelineTab({ tasks }: Props) {
  const [filter, setFilter] = useState<"ours" | "all">("ours");
  const displayed = filter === "ours" ? tasks.filter((t) => t.isOurTask) : tasks;

  function fmt(ts: Timestamp | undefined | null) {
    if (!ts) return "—";
    return format(ts.toDate(), "MMM d, yyyy");
  }

  if (tasks.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <div className="text-3xl mb-3 opacity-40">📅</div>
          <p className="text-sm text-muted-foreground">No tasks yet. Upload a schedule to populate the timeline.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Schedule Timeline</h3>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as "ours" | "all")}>
          <TabsList className="h-7">
            <TabsTrigger value="ours" className="text-xs h-6 px-3">Our Tasks</TabsTrigger>
            <TabsTrigger value="all" className="text-xs h-6 px-3">All Tasks</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex flex-col gap-2">
        {displayed.map((t) => (
          <Card key={t.id}>
            <CardContent className="flex items-center justify-between gap-4 py-3 px-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium truncate">{t.taskName}</span>
                  {t.isOurTask && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 text-blue-600 border-blue-400/40">Ours</Badge>
                  )}
                </div>
                {(t.building || t.floor) && (
                  <div className="text-xs text-muted-foreground font-mono mt-0.5">
                    {[t.building, t.floor].filter(Boolean).join(" – ")}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-4 shrink-0 text-xs font-mono text-muted-foreground">
                <div>
                  <div className="text-[10px] uppercase tracking-wider mb-0.5">Install</div>
                  <div>{fmt(t.gcInstallDate)}</div>
                </div>
                {t.assignedResource && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider mb-0.5">Resource</div>
                    <div>{t.assignedResource}</div>
                  </div>
                )}
                <Badge variant="outline" className="text-[10px]">
                  {TASK_CATEGORY_LABELS[t.category] ?? t.category}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {displayed.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No {filter === "ours" ? "cabinet/countertop" : ""} tasks found.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

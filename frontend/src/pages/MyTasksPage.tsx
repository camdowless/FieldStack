/**
 * MyTasksPage — shows task steps assigned to the current user across all projects.
 */

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckSquare } from "lucide-react";
import { motion } from "framer-motion";
import { Timestamp } from "firebase/firestore";
import { format } from "date-fns";
import { apiGetMyTasks } from "@/lib/fieldstackApi";
import { STEP_TYPE_LABELS } from "@/types/fieldstack";

interface MyTask {
  id: string;
  stepType: string;
  status: string;
  building?: string;
  floor?: string;
  dueDate?: string;
  projectName: string;
  notes?: string;
}

function statusBadge(status: string) {
  if (status === "COMPLETE") return <Badge variant="outline" className="text-emerald-600 border-emerald-400/40 text-[10px]">Complete</Badge>;
  if (status === "IN_PROGRESS") return <Badge variant="secondary" className="text-blue-600 text-[10px]">In Progress</Badge>;
  if (status === "BLOCKED") return <Badge variant="destructive" className="text-[10px]">Blocked</Badge>;
  return <Badge variant="outline" className="text-muted-foreground text-[10px]">Pending</Badge>;
}

export default function MyTasksPage() {
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGetMyTasks()
      .then((data) => setTasks(data as MyTask[]))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 max-w-3xl">
      <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">My Tasks</h1>
        <p className="text-sm text-muted-foreground mt-1">Task steps assigned to you across all projects.</p>
      </motion.div>

      {loading && (
        <div className="flex items-center justify-center py-20 gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading tasks...
        </div>
      )}

      {!loading && tasks.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center">
            <CheckSquare className="h-10 w-10 mx-auto mb-3 text-muted-foreground opacity-40" />
            <p className="text-sm text-muted-foreground">No tasks assigned to you yet.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Task steps can be assigned from the Workflow tab on each project.
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && tasks.length > 0 && (
        <div className="flex flex-col gap-2">
          {tasks.map((t) => (
            <Card key={t.id}>
              <CardContent className="flex items-start justify-between gap-4 py-3 px-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-sm font-medium">
                      {STEP_TYPE_LABELS[t.stepType as keyof typeof STEP_TYPE_LABELS] ?? t.stepType}
                    </span>
                    {(t.building || t.floor) && (
                      <span className="text-xs text-muted-foreground font-mono">
                        {[t.building, t.floor].filter(Boolean).join(" – ")}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">{t.projectName}</div>
                  {t.notes && <div className="text-xs text-muted-foreground mt-1 italic">{t.notes}</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {t.dueDate && (
                    <span className="text-xs text-muted-foreground font-mono">
                      {format(new Date(t.dueDate), "MMM d")}
                    </span>
                  )}
                  {statusBadge(t.status)}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

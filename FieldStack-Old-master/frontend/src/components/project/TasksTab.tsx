import { Calendar, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { TaskDoc } from "@/hooks/useProjectDetail";

const CATEGORY_LABELS: Record<TaskDoc["category"], string> = {
  CABINET_DELIVERY: "Cabinet delivery",
  CABINET_INSTALL: "Cabinet install",
  COUNTERTOP_SET: "Countertop set",
  OTHER: "Other",
};

const CATEGORY_COLORS: Record<TaskDoc["category"], string> = {
  CABINET_DELIVERY: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
  CABINET_INSTALL: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400",
  COUNTERTOP_SET: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  OTHER: "bg-muted text-muted-foreground",
};

interface TasksTabProps {
  tasks: TaskDoc[];
}

export function TasksTab({ tasks }: TasksTabProps) {
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
        <Tag className="h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No tasks yet. Upload a schedule to parse tasks.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 py-2">
      {tasks.map((task) => {
        const location = [task.building, task.floor].filter(Boolean).join(" – ");
        const installDate = new Date(task.gcInstallDate).toLocaleDateString("en-US", {
          month: "short", day: "numeric", year: "numeric",
        });

        return (
          <div key={task.id} className="rounded-lg border bg-card p-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{task.taskName}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_COLORS[task.category]}`}>
                  {CATEGORY_LABELS[task.category]}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                {location && <span>{location}</span>}
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  Install: {installDate}
                </span>
                {task.assignedResource && <span>Assigned: {task.assignedResource}</span>}
              </div>
            </div>
            {!task.isOurTask && (
              <Badge variant="outline" className="text-xs shrink-0">Not ours</Badge>
            )}
          </div>
        );
      })}
    </div>
  );
}

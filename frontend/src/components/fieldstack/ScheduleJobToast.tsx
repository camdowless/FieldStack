/**
 * ScheduleJobToast — persistent bottom-right indicator for in-flight schedule jobs.
 *
 * Rendered once at the app level so it survives navigation. Shows all active
 * and recently completed jobs.
 */

import { Loader2, CheckCircle2, AlertCircle, X } from "lucide-react";
import { useScheduleJobs } from "@/contexts/ScheduleJobContext";

export function ScheduleJobToast() {
  const { jobs, dismissJob } = useScheduleJobs();

  const visible = Object.values(jobs);
  if (visible.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
      {visible.map((job) => (
        <div
          key={job.projectId}
          className="min-w-72 max-w-sm bg-card border rounded-xl p-4 shadow-xl pointer-events-auto"
        >
          {job.status === "running" && (
            <div className="flex items-center gap-3">
              <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{job.projectName}</div>
                <div className="text-xs text-muted-foreground mt-0.5 font-mono">
                  Parsing schedule with AI…
                </div>
              </div>
            </div>
          )}

          {job.status === "done" && job.result && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span className="text-sm font-medium text-emerald-600 truncate">
                    {job.projectName}
                  </span>
                </div>
                <button
                  onClick={() => dismissJob(job.projectId)}
                  className="text-muted-foreground hover:text-foreground text-lg leading-none ml-2 shrink-0"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="text-xs font-mono text-muted-foreground flex gap-4">
                <span>{job.result.tasksCreated} tasks</span>
                <span>{job.result.orderItemsCreated} orders</span>
                <span>v{job.result.version}</span>
                {job.result.changesDetected > 0 && (
                  <span className="text-yellow-500">{job.result.changesDetected} changes</span>
                )}
              </div>
            </div>
          )}

          {job.status === "error" && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                  <span className="text-sm font-medium text-destructive truncate">
                    {job.projectName}
                  </span>
                </div>
                <button
                  onClick={() => dismissJob(job.projectId)}
                  className="text-muted-foreground hover:text-foreground text-lg leading-none ml-2 shrink-0"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="text-xs text-muted-foreground">{job.error}</div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

import { ArrowRight, TrendingUp, TrendingDown } from "lucide-react";
import type { ScheduleChangeDoc } from "@/hooks/useProjectDetail";

interface ChangesTabProps {
  changes: ScheduleChangeDoc[];
}

export function ChangesTab({ changes }: ChangesTabProps) {
  if (changes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
        <ArrowRight className="h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          No schedule changes detected yet. Upload a new schedule version to see date shifts.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 py-2">
      {changes.map((change) => {
        const isDelay = change.shiftDays > 0;
        const location = [change.building, change.floor].filter(Boolean).join(" – ");
        const prevDate = new Date(change.previousDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        const newDate = new Date(change.newDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        const detectedAt = new Date(change.detectedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });

        return (
          <div key={change.id} className="rounded-lg border bg-card p-3 flex items-start gap-3">
            {isDelay
              ? <TrendingUp className="h-4 w-4 shrink-0 mt-0.5 text-red-500" />
              : <TrendingDown className="h-4 w-4 shrink-0 mt-0.5 text-green-500" />
            }
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{change.taskName}</span>
                {location && <span className="text-xs text-muted-foreground">— {location}</span>}
              </div>
              <div className="flex items-center gap-2 mt-1 text-sm">
                <span className="text-muted-foreground line-through">{prevDate}</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span className={isDelay ? "text-red-600 dark:text-red-400 font-medium" : "text-green-600 dark:text-green-400 font-medium"}>
                  {newDate}
                </span>
                <span className={`text-xs font-medium ${isDelay ? "text-red-500" : "text-green-500"}`}>
                  ({isDelay ? "+" : ""}{change.shiftDays}d)
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">Detected {detectedAt}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

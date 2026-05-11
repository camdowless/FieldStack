import { Card, CardContent } from "@/components/ui/card";
import { Timestamp } from "firebase/firestore";
import { format } from "date-fns";
import type { ScheduleChange } from "@/types/fieldstack";

function fmt(ts: Timestamp | undefined | null) {
  if (!ts) return "—";
  return format(ts.toDate(), "MMM d, yyyy");
}

interface Props {
  changes: ScheduleChange[];
}

export function ChangesTab({ changes }: Props) {
  if (changes.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <div className="text-3xl mb-3 opacity-40">📋</div>
          <p className="text-sm text-muted-foreground">No schedule changes detected yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Changes are detected when you upload a new version of the schedule.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Schedule Changes</h3>
        <span className="text-xs text-muted-foreground font-mono">{changes.length} detected</span>
      </div>

      <div className="flex flex-col gap-2">
        {changes.map((c) => (
          <Card key={c.id}>
            <CardContent className="flex items-center justify-between gap-4 py-3 px-4">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{c.taskName}</div>
                {(c.building || c.floor) && (
                  <div className="text-xs text-muted-foreground font-mono mt-0.5">
                    {[c.building, c.floor].filter(Boolean).join(" – ")}
                  </div>
                )}
                <div className="text-xs text-muted-foreground font-mono mt-0.5">
                  Detected: {fmt(c.detectedAt)}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0 text-xs font-mono">
                <span className="text-muted-foreground">{fmt(c.previousDate)}</span>
                <span className="text-muted-foreground">→</span>
                <span className="text-yellow-500">{fmt(c.newDate)}</span>
                <span className={`font-bold ${c.shiftDays > 0 ? "text-red-500" : "text-emerald-500"}`}>
                  {c.shiftDays > 0 ? "+" : ""}{c.shiftDays}d
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

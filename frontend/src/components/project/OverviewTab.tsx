import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { AlertBadge } from "./AlertBadge";
import type { ComputedAlert } from "@/lib/fieldstackApi";

interface OverviewTabProps {
  alerts: ComputedAlert[];
  loading: boolean;
}

export function OverviewTab({ alerts, loading }: OverviewTabProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const actionable = alerts.filter((a) => a.level !== "ON_TRACK");

  if (actionable.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
        <CheckCircle2 className="h-10 w-10 text-green-500" />
        <div>
          <p className="font-semibold">All orders on track</p>
          <p className="text-sm text-muted-foreground mt-0.5">No critical or warning alerts for this project.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 py-2">
      {actionable.map((alert) => (
        <div
          key={alert.orderItemId}
          className="rounded-lg border p-3 flex items-start gap-3"
        >
          <AlertTriangle className={`h-4 w-4 shrink-0 mt-0.5 ${
            alert.level === "CRITICAL" ? "text-red-500" :
            alert.level === "WARNING" ? "text-amber-500" : "text-blue-500"
          }`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium">{alert.title}</p>
              <AlertBadge level={alert.level} />
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{alert.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

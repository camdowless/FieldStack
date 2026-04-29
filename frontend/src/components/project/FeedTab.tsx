import { Activity } from "lucide-react";
import type { FeedEntryDoc } from "@/hooks/useProjectDetail";

const FEED_ICONS: Record<string, string> = {
  SCHEDULE_UPLOAD: "📄",
  TASK_PARSED: "✅",
  ORDER_UPDATED: "📦",
  SCHEDULE_CHANGE: "📅",
  ALERT_SENT: "🔔",
  PROJECT_CREATED: "🏗️",
};

interface FeedTabProps {
  entries: FeedEntryDoc[];
}

export function FeedTab({ entries }: FeedTabProps) {
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
        <Activity className="h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          No activity yet. Actions on this project will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 py-2">
      {entries.map((entry) => {
        const icon = FEED_ICONS[entry.type] ?? "•";
        const timeStr = new Date(entry.createdAt).toLocaleDateString("en-US", {
          month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
        });

        return (
          <div key={entry.id} className="flex items-start gap-3 py-2.5 border-b last:border-b-0">
            <span className="text-base shrink-0 mt-0.5">{icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{entry.title}</p>
              <p className="text-xs text-muted-foreground">{entry.summary}</p>
            </div>
            <span className="text-xs text-muted-foreground shrink-0">{timeStr}</span>
          </div>
        );
      })}
    </div>
  );
}

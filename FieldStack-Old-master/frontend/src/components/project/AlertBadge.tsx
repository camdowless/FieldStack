import type { AlertLevel } from "@/lib/fieldstackApi";
import { cn } from "@/lib/utils";

interface AlertBadgeProps {
  level: AlertLevel;
  count?: number;
  className?: string;
}

const STYLES: Record<AlertLevel, string> = {
  CRITICAL: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 border-red-200 dark:border-red-800",
  WARNING:  "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-amber-200 dark:border-amber-800",
  INFO:     "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 border-blue-200 dark:border-blue-800",
  ON_TRACK: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400 border-green-200 dark:border-green-800",
  VERIFY:   "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-400 border-purple-200 dark:border-purple-800",
};

export function AlertBadge({ level, count, className }: AlertBadgeProps) {
  const label = level === "ON_TRACK" ? "On track" : level === "VERIFY" ? "Verify" : level.charAt(0) + level.slice(1).toLowerCase();
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold",
      STYLES[level],
      className
    )}>
      {count !== undefined ? `${count} ${label}` : label}
    </span>
  );
}

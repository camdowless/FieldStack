import { cn } from "@/lib/utils";

export type SiteStatus = "no website" | "dead site" | "active";

/** Map raw backend labels to the 3-state status model */
export function deriveSiteStatus(label?: string): SiteStatus {
  if (!label) return "active";
  const l = label.toLowerCase();
  if (l === "no website") return "no website";
  if (l === "dead site" || l === "parked") return "dead site";
  return "active";
}

const STATUS_CONFIG: Record<SiteStatus, { label: string; bg: string; text: string; border: string }> = {
  "no website": { label: "No Website", bg: "bg-gray-100 dark:bg-gray-800", text: "text-gray-600 dark:text-gray-400", border: "border-gray-300 dark:border-gray-600" },
  "dead site": { label: "Dead Site", bg: "bg-red-50 dark:bg-red-950", text: "text-red-600 dark:text-red-400", border: "border-red-200 dark:border-red-800" },
  "active": { label: "Active", bg: "bg-yellow-50 dark:bg-yellow-950", text: "text-yellow-700 dark:text-yellow-400", border: "border-yellow-200 dark:border-yellow-700" },
};

interface StatusChipProps {
  status: SiteStatus;
  className?: string;
}

export function StatusChip({ status, className }: StatusChipProps) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        config.bg,
        config.text,
        config.border,
        className
      )}
    >
      {config.label}
    </span>
  );
}

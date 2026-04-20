import { cn } from "@/lib/utils";

/** Labels that represent disqualified/filtered-out businesses */
const DISQUALIFIED_LABELS = new Set(["disqualified", "defunct", "permanently closed"]);

/** Labels that represent a factual site/business status (shown as text) */
const STATUS_LABELS = new Set(["no website", "dead site", "parked", "third-party listing"]);

interface LeadScoreBadgeProps {
  score: number | null;
  label?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function LeadScoreBadge({ score, label, size = "md", className }: LeadScoreBadgeProps) {
  const isDisqualified = label ? DISQUALIFIED_LABELS.has(label) : false;
  const isStatus = label ? STATUS_LABELS.has(label) : false;
  const displayScore = isDisqualified ? 0 : (score ?? 0);

  const getColor = () => {
    if (isDisqualified) return "bg-gray-500/15 text-gray-500 border-gray-500/30";
    if (displayScore >= 70) return "bg-green-500/15 text-green-600 border-green-500/30";
    if (displayScore >= 40) return "bg-yellow-500/15 text-yellow-600 border-yellow-500/30";
    return "bg-red-500/15 text-red-600 border-red-500/30";
  };

  const sizeClasses = {
    sm: "text-xs px-2 py-0.5",
    md: "text-sm px-2.5 py-1",
    lg: "text-base px-3 py-1.5 font-semibold",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium capitalize",
        getColor(),
        sizeClasses[size],
        className
      )}
    >
      <span className="font-bold">{displayScore}</span>
      {isStatus && label && (
        <>
          <span className="opacity-70">•</span>
          <span>{label}</span>
        </>
      )}
    </span>
  );
}

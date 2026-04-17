import { cn } from "@/lib/utils";

interface LeadScoreBadgeProps {
  score: number;
  label?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function LeadScoreBadge({ score, label, size = "md", className }: LeadScoreBadgeProps) {
  const getColor = () => {
    if (score >= 70) return "bg-green-500/15 text-green-600 border-green-500/30";
    if (score >= 40) return "bg-yellow-500/15 text-yellow-600 border-yellow-500/30";
    return "bg-red-500/15 text-red-600 border-red-500/30";
  };

  const getLabel = () => {
    // Hot Lead override: high score on a no-website business is a top opportunity
    if (score >= 80 && label && label.toLowerCase() === "no website") return "Hot Lead";
    if (label) return label;
    if (score >= 70) return "Hot Lead";
    if (score >= 40) return "Warm";
    return "Cool";
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
      <span className="font-bold">{score}</span>
      <span className="opacity-70">•</span>
      <span>{getLabel()}</span>
    </span>
  );
}

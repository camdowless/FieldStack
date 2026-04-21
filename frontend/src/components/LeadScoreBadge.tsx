import { cn } from "@/lib/utils";

interface LeadScoreBadgeProps {
  score: number | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function LeadScoreBadge({ score, size = "md", className }: LeadScoreBadgeProps) {
  const displayScore = score ?? 0;

  const getColor = () => {
    if (displayScore >= 70) return "text-green-600";
    if (displayScore >= 40) return "text-yellow-600";
    return "text-red-600";
  };

  const sizeClasses = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-lg",
  };

  return (
    <span
      className={cn(
        "font-bold tabular-nums",
        getColor(),
        sizeClasses[size],
        className
      )}
    >
      {displayScore}
    </span>
  );
}

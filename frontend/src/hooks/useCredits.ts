import { useAuth } from "@/contexts/AuthContext";

export function useCredits() {
  const { profile } = useAuth();
  const sub = profile?.subscription;

  const used = sub?.creditsUsed ?? 0;
  const total = sub?.creditsTotal ?? 0;
  const remaining = Math.max(0, total - used);

  const periodEnd = sub?.currentPeriodEnd as { seconds: number } | null | undefined;
  const refreshDate = periodEnd?.seconds
    ? new Date(periodEnd.seconds * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  return {
    remaining,
    max: total,
    used,
    plan: sub?.plan ?? "free",
    hasCredits: remaining > 0,
    refreshDate,
  };
}

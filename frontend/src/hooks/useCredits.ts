import { useAuth } from "@/contexts/AuthContext";

export function useCredits() {
  const { profile } = useAuth();
  const sub = profile?.subscription;

  const used = sub?.creditsUsed ?? 0;
  const total = sub?.creditsTotal ?? 0;
  const remaining = Math.max(0, total - used);

  return {
    remaining,
    max: total,
    used,
    plan: sub?.plan ?? "free",
    hasCredits: remaining > 0,
  };
}

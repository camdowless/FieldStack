import { useState, useEffect, useCallback } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";

export interface UserPreferences {
  opportunityScoreMin: number;
  legitimacyScoreMin: number;
}

const DEFAULTS: UserPreferences = {
  opportunityScoreMin: 25,
  legitimacyScoreMin: 35,
};

export function usePreferences() {
  const { user, profile } = useAuth();
  const [prefs, setPrefs] = useState<UserPreferences>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  // Wait for profile to exist before reading/writing preferences.
  // This prevents creating a ghost parent document before onUserCreate fires.
  useEffect(() => {
    if (!user || !profile) {
      setPrefs(DEFAULTS);
      setLoaded(false);
      return;
    }

    const ref = doc(firestore, "users", user.uid, "preferences", "search");
    getDoc(ref).then((snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setPrefs({
          opportunityScoreMin: typeof data.opportunityScoreMin === "number" ? data.opportunityScoreMin : DEFAULTS.opportunityScoreMin,
          legitimacyScoreMin: typeof data.legitimacyScoreMin === "number" ? data.legitimacyScoreMin : DEFAULTS.legitimacyScoreMin,
        });
      } else {
        // New user — persist defaults so they're locked in
        setDoc(ref, DEFAULTS).catch((err) => {
          console.error("[preferences] failed to save defaults:", err);
        });
      }
      setLoaded(true);
    }).catch(() => {
      setLoaded(true);
    });
  }, [user, profile]);

  const update = useCallback((patch: Partial<UserPreferences>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };

      // Persist to Firestore (fire-and-forget)
      if (user) {
        const ref = doc(firestore, "users", user.uid, "preferences", "search");
        setDoc(ref, next, { merge: true }).catch((err) => {
          console.error("[preferences] save failed:", err);
        });
      }

      return next;
    });
  }, [user]);

  return { prefs, update, loaded };
}

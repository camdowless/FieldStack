import { useState, useEffect, useCallback, useRef } from "react";
import { doc, setDoc } from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";

const DEBOUNCE_MS = 600;

export interface UserPreferences {
  itemsPerPage: number;
  // Add your app-specific preferences here
}

const DEFAULTS: UserPreferences = {
  itemsPerPage: 20,
};

/**
 * Reads preferences from the user profile doc (already listened to by AuthContext)
 * instead of opening a separate Firestore read.
 *
 * Writes are debounced to avoid spamming Firestore on rapid slider changes.
 */
export function usePreferences() {
  const { user, profile } = useAuth();
  const [prefs, setPrefs] = useState<UserPreferences>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user || !profile) {
      setPrefs(DEFAULTS);
      setLoaded(false);
      return;
    }

    const embedded = profile.preferences;
    if (embedded) {
      setPrefs({
        itemsPerPage: typeof embedded.itemsPerPage === "number" ? embedded.itemsPerPage : DEFAULTS.itemsPerPage,
      });
      setLoaded(true);
      return;
    }

    // No preferences yet - write defaults to profile doc
    const profileRef = doc(firestore, "users", user.uid);
    setDoc(profileRef, { preferences: DEFAULTS }, { merge: true })
      .catch((err) => console.error("[preferences] default write failed:", err))
      .finally(() => setLoaded(true));
  }, [user, profile]);

  const update = useCallback(
    (patch: Partial<UserPreferences>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch };
        if (user) {
          if (debounceTimer.current) clearTimeout(debounceTimer.current);
          debounceTimer.current = setTimeout(() => {
            const profileRef = doc(firestore, "users", user.uid);
            setDoc(profileRef, { preferences: next }, { merge: true })
              .catch((err) => console.error("[preferences] save failed:", err));
          }, DEBOUNCE_MS);
        }
        return next;
      });
    },
    [user],
  );

  return { prefs, update, loaded };
}

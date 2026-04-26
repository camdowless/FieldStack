import { useState, useEffect, useCallback, useRef } from "react";
import { doc, setDoc } from "firebase/firestore";
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

/**
 * Reads preferences from the user profile doc (already listened to by AuthContext)
 * instead of opening a separate Firestore read on the preferences subcollection.
 *
 * Writes still go to the profile doc's `preferences` field. On first load for
 * users who don't have the field yet, we migrate from the old subcollection doc
 * once, then write defaults to the profile doc.
 */
export function usePreferences() {
  const { user, profile } = useAuth();
  const [prefs, setPrefs] = useState<UserPreferences>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const migratedRef = useRef(false);

  useEffect(() => {
    if (!user || !profile) {
      setPrefs(DEFAULTS);
      setLoaded(false);
      migratedRef.current = false;
      return;
    }

    // Read preferences from the profile doc (free — already listened to)
    const embedded = profile.preferences;
    if (embedded) {
      setPrefs({
        opportunityScoreMin:
          typeof embedded.opportunityScoreMin === "number"
            ? embedded.opportunityScoreMin
            : DEFAULTS.opportunityScoreMin,
        legitimacyScoreMin:
          typeof embedded.legitimacyScoreMin === "number"
            ? embedded.legitimacyScoreMin
            : DEFAULTS.legitimacyScoreMin,
      });
      setLoaded(true);
      return;
    }

    // Profile doc doesn't have preferences yet — migrate from old subcollection
    // or write defaults. Only do this once per session.
    if (migratedRef.current) {
      setLoaded(true);
      return;
    }
    migratedRef.current = true;

    // Try reading the old subcollection doc and migrating
    import("firebase/firestore").then(({ getDoc, doc: docRef }) => {
      const oldRef = docRef(firestore, "users", user.uid, "preferences", "search");
      getDoc(oldRef)
        .then((snap) => {
          const data = snap.exists() ? snap.data() : null;
          const migrated: UserPreferences = {
            opportunityScoreMin:
              typeof data?.opportunityScoreMin === "number"
                ? data.opportunityScoreMin
                : DEFAULTS.opportunityScoreMin,
            legitimacyScoreMin:
              typeof data?.legitimacyScoreMin === "number"
                ? data.legitimacyScoreMin
                : DEFAULTS.legitimacyScoreMin,
          };
          setPrefs(migrated);

          // Write to profile doc so future loads are free
          const profileRef = doc(firestore, "users", user.uid);
          setDoc(profileRef, { preferences: migrated }, { merge: true }).catch(
            (err) => console.error("[preferences] migration write failed:", err),
          );
        })
        .catch(() => {
          // Can't read old doc — just write defaults to profile
          const profileRef = doc(firestore, "users", user.uid);
          setDoc(profileRef, { preferences: DEFAULTS }, { merge: true }).catch(
            (err) => console.error("[preferences] default write failed:", err),
          );
        })
        .finally(() => setLoaded(true));
    });
  }, [user, profile]);

  const update = useCallback(
    (patch: Partial<UserPreferences>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch };

        // Persist to the profile doc (fire-and-forget)
        if (user) {
          const profileRef = doc(firestore, "users", user.uid);
          setDoc(profileRef, { preferences: next }, { merge: true }).catch(
            (err) => console.error("[preferences] save failed:", err),
          );
        }

        return next;
      });
    },
    [user],
  );

  return { prefs, update, loaded };
}

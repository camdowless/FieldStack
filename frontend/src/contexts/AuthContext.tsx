import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, googleProvider, firestore } from "@/lib/firebase";
import { getFunctions, httpsCallable } from "firebase/functions";

export interface Subscription {
  plan: "free" | "soloPro" | "agency" | "pro";
  status: "active" | "past_due" | "cancelled" | "trialing";
  creditsUsed: number;
  creditsTotal: number;
  currentPeriodStart: unknown;
  currentPeriodEnd: unknown;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  subscription: Subscription;
  createdAt: unknown;
  updatedAt: unknown;
}

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  role: "user" | "admin" | null;
  loading: boolean;
  isNewUser: boolean;
  emailVerified: boolean;
  signIn: (email: string, password: string) => Promise<{ needsVerification?: boolean }>;
  signUp: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  refreshEmailVerified: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const PROFILE_TIMEOUT_MS = 12_000;
const CLAIM_TIMEOUT_MS = 8_000;
const CLAIM_POLL_INTERVAL_MS = 1_500;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [role, setRole] = useState<"user" | "admin" | null>(null);
  const [loading, setLoading] = useState(true);
  const [isNewUser, setIsNewUser] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);

  useEffect(() => {
    let profileUnsub: (() => void) | null = null;
    let profileTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let claimTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let claimPollId: ReturnType<typeof setInterval> | null = null;
    let settled = false;

    function clearTimers() {
      if (profileTimeoutId) { clearTimeout(profileTimeoutId); profileTimeoutId = null; }
      if (claimTimeoutId) { clearTimeout(claimTimeoutId); claimTimeoutId = null; }
      if (claimPollId) { clearInterval(claimPollId); claimPollId = null; }
    }

    function teardownProfile() {
      clearTimers();
      if (profileUnsub) { profileUnsub(); profileUnsub = null; }
    }

    function settle(resolvedRole: "user" | "admin", reason: string) {
      if (settled) {
        console.log(`[AuthContext] settle() called again (already settled) — ignoring. reason="${reason}"`);
        return;
      }
      settled = true;
      clearTimers();
      console.log(`[AuthContext] ✅ SETTLED role="${resolvedRole}" reason="${reason}" loading→false`);
      setRole(resolvedRole);
      setLoading(false);
    }

    const authUnsub = onAuthStateChanged(auth, async (u) => {
      console.log(`[AuthContext] onAuthStateChanged fired — uid=${u?.uid ?? "null"} email=${u?.email ?? "null"} isAnonymous=${u?.isAnonymous ?? "n/a"}`);

      teardownProfile();
      settled = false;

      if (!u) {
        console.log("[AuthContext] No user — clearing state, loading→false");
        setUser(null);
        setProfile(null);
        setRole(null);
        setIsNewUser(false);
        setEmailVerified(false);
        setLoading(false);
        return;
      }

      // Validate the cached session token is still live
      console.log(`[AuthContext] Validating cached session token for uid=${u.uid}…`);
      try {
        const token = await u.getIdToken(false);
        console.log(`[AuthContext] Session token valid. uid=${u.uid} token_prefix=${token.slice(0, 20)}…`);
      } catch (err) {
        console.warn(`[AuthContext] ❌ Stale/invalid session token uid=${u.uid} — signing out.`, err);
        await signOut(auth);
        return;
      }

      setUser(u);
      setEmailVerified(u.emailVerified);
      setLoading(true);
      console.log(`[AuthContext] User set, loading→true. Waiting for Firestore profile doc users/${u.uid}…`);

      // ── Step 1: Wait for Firestore profile doc ──────────────────────────────
      profileTimeoutId = setTimeout(() => {
        console.warn(`[AuthContext] ⏱ Profile doc timeout after ${PROFILE_TIMEOUT_MS}ms uid=${u.uid} — settling with default role="user"`);
        settle("user", "profile-doc-timeout");
      }, PROFILE_TIMEOUT_MS);

      const profileRef = doc(firestore, "users", u.uid);
      console.log(`[AuthContext] Subscribing to Firestore users/${u.uid}…`);

      profileUnsub = onSnapshot(profileRef, async (snap) => {
        if (!snap.exists()) {
          console.log(`[AuthContext] Profile doc users/${u.uid} does not exist yet — waiting…`);
          setIsNewUser(true);
          return;
        }

        const data = snap.data() as UserProfile;
        console.log(`[AuthContext] ✅ Profile doc arrived uid=${u.uid} fields=${JSON.stringify(Object.keys(data))}`);
        setProfile(data);
        setIsNewUser(false);

        if (profileTimeoutId) { clearTimeout(profileTimeoutId); profileTimeoutId = null; }

        // Fire-and-forget sync: reconcile Stripe → Firestore on page load.
        // Throttled to once every 5 minutes to avoid hammering Stripe on every refresh.
        u.getIdToken().then((token) => {
          const lastSync = parseInt(sessionStorage.getItem("lastSubSync") ?? "0", 10);
          const fiveMinutes = 5 * 60 * 1000;
          if (Date.now() - lastSync < fiveMinutes) return;
          sessionStorage.setItem("lastSubSync", String(Date.now()));
          fetch("/api/syncSubscription", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          }).catch((err) => console.warn("[AuthContext] syncSubscription failed", err));
        });

        // ── Step 2: Poll for role custom claim ──────────────────────────────
        let claimResolved = false;
        let pollCount = 0;

        async function pollForClaim() {
          pollCount++;
          console.log(`[AuthContext] 🔄 Token refresh attempt #${pollCount} uid=${u.uid} (forceRefresh=true)…`);
          try {
            const tokenResult = await u.getIdTokenResult(true);
            const claimRole = tokenResult.claims.role as string | undefined;
            const expiry = tokenResult.expirationTime;
            const issuedAt = tokenResult.issuedAtTime;
            console.log(
              `[AuthContext] Token result #${pollCount}: role="${claimRole ?? "MISSING"}" ` +
              `issuedAt=${issuedAt} expiresAt=${expiry} ` +
              `allClaims=${JSON.stringify(tokenResult.claims)}`
            );

            if (claimRole === "user" || claimRole === "admin") {
              claimResolved = true;
              if (claimPollId) { clearInterval(claimPollId); claimPollId = null; }
              if (claimTimeoutId) { clearTimeout(claimTimeoutId); claimTimeoutId = null; }
              console.log(`[AuthContext] ✅ Role claim resolved: "${claimRole}" on attempt #${pollCount}`);
              settle(claimRole, `claim-poll-attempt-${pollCount}`);
            } else {
              console.log(`[AuthContext] Role claim not present yet on attempt #${pollCount} — will retry in ${CLAIM_POLL_INTERVAL_MS}ms`);
            }
          } catch (err) {
            console.warn(`[AuthContext] ❌ Token refresh failed on attempt #${pollCount} uid=${u.uid}`, err);
          }
        }

        await pollForClaim();
        if (claimResolved) return;

        claimPollId = setInterval(pollForClaim, CLAIM_POLL_INTERVAL_MS);

        claimTimeoutId = setTimeout(() => {
          if (claimResolved) return;
          if (claimPollId) { clearInterval(claimPollId); claimPollId = null; }
          console.warn(`[AuthContext] ⏱ Role claim timeout after ${CLAIM_TIMEOUT_MS}ms uid=${u.uid} after ${pollCount} attempts — defaulting to "user"`);
          settle("user", "claim-timeout");
        }, CLAIM_TIMEOUT_MS);

      }, (err) => {
        console.error(`[AuthContext] ❌ Firestore profile snapshot error uid=${u.uid}`, err);
        settle("user", "firestore-snapshot-error");
      });
    });

    return () => {
      console.log("[AuthContext] Cleanup — unsubscribing auth listener and tearing down profile");
      authUnsub();
      teardownProfile();
    };
  }, []);

  const signIn = async (email: string, password: string): Promise<{ needsVerification?: boolean }> => {
    console.log(`[AuthContext] signIn() called email=${email}`);
    await signInWithEmailAndPassword(auth, email, password);
    console.log(`[AuthContext] signIn() Firebase call complete — onAuthStateChanged will fire next`);
    return {};
  };

  const resendVerificationEmail = async () => {
    const fns = getFunctions();
    const callable = httpsCallable(fns, "resendVerificationEmail");
    await callable({});
  };

  const refreshEmailVerified = async () => {
    if (!auth.currentUser) return;
    await auth.currentUser.reload();
    const verified = auth.currentUser.emailVerified;
    setEmailVerified(verified);
  };

  const signUp = async (email: string, password: string) => {
    console.log(`[AuthContext] signUp() called email=${email}`);
    await createUserWithEmailAndPassword(auth, email, password);
    console.log(`[AuthContext] signUp() Firebase call complete — onAuthStateChanged will fire next`);
  };

  const signInWithGoogle = async () => {
    console.log("[AuthContext] signInWithGoogle() called");
    await signInWithPopup(auth, googleProvider);
    console.log("[AuthContext] signInWithGoogle() complete — onAuthStateChanged will fire next");
  };

  const sendPasswordReset = async (email: string) => {
    const functions = getFunctions();
    const callable = httpsCallable(functions, "sendPasswordReset");
    await callable({ email });
  };

  const logout = async () => {
    console.log(`[AuthContext] logout() called — current uid=${auth.currentUser?.uid ?? "null"}`);
    await signOut(auth);
    console.log("[AuthContext] signOut() complete — onAuthStateChanged will fire with null user");
    window.history.replaceState(null, "", "/");
  };

  return (
    <AuthContext.Provider value={{ user, profile, role, loading, isNewUser, emailVerified, signIn, signUp, signInWithGoogle, sendPasswordReset, resendVerificationEmail, refreshEmailVerified, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

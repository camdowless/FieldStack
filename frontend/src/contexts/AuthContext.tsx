import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  confirmPasswordReset,
  applyActionCode,
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
  preferences?: {
    opportunityScoreMin: number;
    legitimacyScoreMin: number;
  };
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
  confirmPasswordReset: (oobCode: string, newPassword: string) => Promise<void>;
  applyActionCode: (oobCode: string) => Promise<void>;
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

    function settle(resolvedRole: "user" | "admin", _reason: string) {
      if (settled) return;
      settled = true;
      clearTimers();
      setRole(resolvedRole);
      setLoading(false);
    }

    const authUnsub = onAuthStateChanged(auth, async (u) => {
      teardownProfile();
      settled = false;

      if (!u) {
        setUser(null);
        setProfile(null);
        setRole(null);
        setIsNewUser(false);
        setEmailVerified(false);
        setLoading(false);
        return;
      }

      // Validate the cached session token is still live
      try {
        await u.getIdToken(false);
      } catch {
        await signOut(auth);
        return;
      }

      setUser(u);
      setEmailVerified(u.emailVerified);
      setLoading(true);

      // ── Step 1: Wait for Firestore profile doc ──────────────────────────────
      profileTimeoutId = setTimeout(() => {
        settle("user", "profile-doc-timeout");
      }, PROFILE_TIMEOUT_MS);

      const profileRef = doc(firestore, "users", u.uid);

      profileUnsub = onSnapshot(profileRef, async (snap) => {
        if (!snap.exists()) {
          setIsNewUser(true);
          return;
        }

        const data = snap.data() as UserProfile;
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
          }).catch(() => {});
        });

        // ── Step 2: Poll for role custom claim ──────────────────────────────
        let claimResolved = false;
        let pollCount = 0;

        async function pollForClaim() {
          pollCount++;
          try {
            const tokenResult = await u.getIdTokenResult(true);
            const claimRole = tokenResult.claims.role as string | undefined;

            if (claimRole === "user" || claimRole === "admin") {
              claimResolved = true;
              if (claimPollId) { clearInterval(claimPollId); claimPollId = null; }
              if (claimTimeoutId) { clearTimeout(claimTimeoutId); claimTimeoutId = null; }
              settle(claimRole, `claim-poll-attempt-${pollCount}`);
            }
          } catch {
            // Token refresh failed — will retry on next poll interval
          }
        }

        await pollForClaim();
        if (claimResolved) return;

        claimPollId = setInterval(pollForClaim, CLAIM_POLL_INTERVAL_MS);

        claimTimeoutId = setTimeout(() => {
          if (claimResolved) return;
          if (claimPollId) { clearInterval(claimPollId); claimPollId = null; }
          settle("user", "claim-timeout");
        }, CLAIM_TIMEOUT_MS);

      }, (err) => {
        console.error(`[AuthContext] ❌ Firestore profile snapshot error uid=${u.uid}`, err);
        settle("user", "firestore-snapshot-error");
      });
    });

    return () => {
      authUnsub();
      teardownProfile();
    };
  }, []);

  const signIn = async (email: string, password: string): Promise<{ needsVerification?: boolean }> => {
    await signInWithEmailAndPassword(auth, email, password);
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
    await createUserWithEmailAndPassword(auth, email, password);
  };

  const signInWithGoogle = async () => {
    await signInWithPopup(auth, googleProvider);
  };

  const sendPasswordReset = async (email: string) => {
    const functions = getFunctions();
    const callable = httpsCallable(functions, "sendPasswordReset");
    await callable({ email });
  };

  const confirmPasswordResetFn = async (oobCode: string, newPassword: string) => {
    await confirmPasswordReset(auth, oobCode, newPassword);
  };

  const applyActionCodeFn = async (oobCode: string) => {
    await applyActionCode(auth, oobCode);
  };

  const logout = async () => {
    await signOut(auth);
    window.history.replaceState(null, "", "/");
  };

  return (
    <AuthContext.Provider value={{ user, profile, role, loading, isNewUser, emailVerified, signIn, signUp, signInWithGoogle, sendPasswordReset, confirmPasswordReset: confirmPasswordResetFn, applyActionCode: applyActionCodeFn, resendVerificationEmail, refreshEmailVerified, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  confirmPasswordReset,
  applyActionCode,
  updateProfile as firebaseUpdateProfile,
  type User,
} from "firebase/auth";
import { doc, onSnapshot, updateDoc, serverTimestamp } from "firebase/firestore";
import { auth, googleProvider, firestore } from "@/lib/firebase";
import { getFunctions, httpsCallable } from "firebase/functions";

export interface Subscription {
  plan: "free" | "pro" | "agency" | "enterprise";
  status: "active" | "past_due" | "cancelled" | "trialing";
  creditsUsed: number;
  creditsTotal: number;
  currentPeriodStart: unknown;
  currentPeriodEnd: unknown;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  /** The Stripe price ID currently active on this subscription (monthly or annual). */
  stripePriceId: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  company?: string | null;
  subscription: Subscription;
  preferences?: {
    itemsPerPage: number;
    // Add your app-specific preferences here
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
  /** Updates the user's display name and company in Firestore and Firebase Auth. */
  updateProfile: (data: { displayName?: string; company?: string }) => Promise<void>;
  /** Permanently deletes the account and all associated data (GDPR/CCPA). */
  deleteAccount: () => Promise<void>;
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
      console.log(`[AuthContext] SETTLED role=${resolvedRole} reason=${_reason}`);
      clearTimers();
      setRole(resolvedRole);
      setLoading(false);
    }

    const authUnsub = onAuthStateChanged(auth, async (u) => {
      console.log(`[AuthContext] onAuthStateChanged uid=${u?.uid ?? "null"} email=${u?.email ?? "null"}`);
      teardownProfile();
      settled = false;

      if (!u) {
        console.log(`[AuthContext] No user — clearing state`);
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
        console.log(`[AuthContext] Token validated uid=${u.uid}`);
      } catch (tokenErr) {
        console.error(`[AuthContext] Token validation FAILED uid=${u.uid} — signing out`, tokenErr);
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
          console.log(`[AuthContext] Profile doc NOT FOUND uid=${u.uid} — marking isNewUser=true`);
          setIsNewUser(true);
          return;
        }

        const data = snap.data() as UserProfile;
        console.log(`[AuthContext] Profile doc RECEIVED uid=${u.uid} plan=${data.subscription?.plan ?? "unknown"}`);
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
            console.log(`[AuthContext] pollForClaim #${pollCount} uid=${u.uid} claimRole=${claimRole ?? "undefined"}`);

            if (claimRole === "user" || claimRole === "admin") {
              claimResolved = true;
              if (claimPollId) { clearInterval(claimPollId); claimPollId = null; }
              if (claimTimeoutId) { clearTimeout(claimTimeoutId); claimTimeoutId = null; }
              settle(claimRole, `claim-poll-attempt-${pollCount}`);
            }
          } catch (pollErr) {
            console.warn(`[AuthContext] pollForClaim #${pollCount} FAILED uid=${u.uid}`, pollErr);
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
    console.log(`[AuthContext] signIn attempt email=${email}`);
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      console.log(`[AuthContext] signIn SUCCESS uid=${result.user.uid} emailVerified=${result.user.emailVerified}`);
      return {};
    } catch (err: unknown) {
      console.error(`[AuthContext] signIn FAILED email=${email}`, err);
      throw err;
    }
  };

  const resendVerificationEmail = async () => {
    console.log(`[AuthContext] resendVerificationEmail called uid=${auth.currentUser?.uid ?? "none"}`);
    const fns = getFunctions();
    const callable = httpsCallable(fns, "resendVerificationEmail");
    try {
      const result = await callable({});
      console.log(`[AuthContext] resendVerificationEmail SUCCESS`, result.data);
    } catch (err: unknown) {
      console.error(`[AuthContext] resendVerificationEmail FAILED`, err);
      throw err;
    }
  };

  const refreshEmailVerified = async () => {
    if (!auth.currentUser) return;
    await auth.currentUser.reload();
    const verified = auth.currentUser.emailVerified;
    console.log(`[AuthContext] refreshEmailVerified uid=${auth.currentUser.uid} verified=${verified}`);
    setEmailVerified(verified);
  };

  const signUp = async (email: string, password: string) => {
    console.log(`[AuthContext] signUp attempt email=${email}`);
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      console.log(`[AuthContext] signUp SUCCESS uid=${result.user.uid} email=${result.user.email}`);
    } catch (err: unknown) {
      console.error(`[AuthContext] signUp FAILED email=${email}`, err);
      throw err;
    }
  };

  const signInWithGoogle = async () => {
    console.log(`[AuthContext] signInWithGoogle attempt`);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      console.log(`[AuthContext] signInWithGoogle SUCCESS uid=${result.user.uid} email=${result.user.email} isNewUser=${result.user.metadata.creationTime === result.user.metadata.lastSignInTime}`);
    } catch (err: unknown) {
      console.error(`[AuthContext] signInWithGoogle FAILED`, err);
      throw err;
    }
  };

  const sendPasswordReset = async (email: string) => {
    console.log(`[AuthContext] sendPasswordReset email=${email}`);
    const functions = getFunctions();
    const callable = httpsCallable(functions, "sendPasswordReset");
    await callable({ email });
    console.log(`[AuthContext] sendPasswordReset dispatched`);
  };

  const confirmPasswordResetFn = async (oobCode: string, newPassword: string) => {
    console.log(`[AuthContext] confirmPasswordReset called`);
    await confirmPasswordReset(auth, oobCode, newPassword);
    console.log(`[AuthContext] confirmPasswordReset SUCCESS`);
  };

  const applyActionCodeFn = async (oobCode: string) => {
    console.log(`[AuthContext] applyActionCode called`);
    await applyActionCode(auth, oobCode);
    console.log(`[AuthContext] applyActionCode SUCCESS`);
  };

  const logout = async () => {
    console.log(`[AuthContext] logout uid=${auth.currentUser?.uid ?? "none"}`);
    await signOut(auth);
    console.log(`[AuthContext] logout COMPLETE`);
    window.history.replaceState(null, "", "/");
  };

  const updateUserProfile = async (data: { displayName?: string; company?: string }) => {
    if (!auth.currentUser) throw new Error("Not authenticated");
    console.log(`[AuthContext] updateProfile uid=${auth.currentUser.uid}`, data);
    const updates: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (data.displayName !== undefined) updates.displayName = data.displayName;
    if (data.company !== undefined) updates.company = data.company;
    await updateDoc(doc(firestore, "users", auth.currentUser.uid), updates);
    if (data.displayName !== undefined) {
      await firebaseUpdateProfile(auth.currentUser, { displayName: data.displayName });
    }
    console.log(`[AuthContext] updateProfile SUCCESS`);
  };

  const deleteAccount = async () => {
    console.log(`[AuthContext] deleteAccount uid=${auth.currentUser?.uid ?? "none"}`);
    const fns = getFunctions();
    const callable = httpsCallable(fns, "deleteUserAccount");
    await callable({ confirm: true });
    console.log(`[AuthContext] deleteAccount server-side COMPLETE — signing out locally`);
    // Auth account is now deleted server-side; sign out locally to clear state.
    await signOut(auth);
    window.history.replaceState(null, "", "/");
  };

  return (
    <AuthContext.Provider value={{ user, profile, role, loading, isNewUser, emailVerified, signIn, signUp, signInWithGoogle, sendPasswordReset, confirmPasswordReset: confirmPasswordResetFn, applyActionCode: applyActionCodeFn, resendVerificationEmail, refreshEmailVerified, logout, updateProfile: updateUserProfile, deleteAccount }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

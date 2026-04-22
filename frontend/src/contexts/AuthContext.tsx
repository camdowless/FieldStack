import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  type User,
} from "firebase/auth";
import { auth, googleProvider } from "@/lib/firebase";

interface AuthContextValue {
  user: User | null;
  role: "user" | "admin" | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ needsVerification?: boolean }>;
  signUp: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<"user" | "admin" | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        // Uses cached token (up to 1hr stale). Role changes won't reflect in
        // the UI until the token refreshes naturally or the user reloads.
        // Backend enforces roles correctly regardless — this is UI-only lag.
        const tokenResult = await u.getIdTokenResult();
        setRole((tokenResult.claims.role as "user" | "admin") ?? null);
      } else {
        setRole(null);
      }
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  const signIn = async (email: string, password: string): Promise<{ needsVerification?: boolean }> => {
    await signInWithEmailAndPassword(auth, email, password);
    // EMAIL VERIFICATION DISABLED — re-enable by uncommenting the block below
    // when you're ready to enforce verified emails on sign-in.
    // if (!cred.user.emailVerified) {
    //   return { needsVerification: true };
    // }
    return {};
  };

  const resendVerificationEmail = async () => {
    // EMAIL VERIFICATION DISABLED — re-enable alongside the signIn check above
    // if (auth.currentUser) {
    //   await sendEmailVerification(auth.currentUser);
    // }
  };

  const signUp = async (email: string, password: string) => {
    await createUserWithEmailAndPassword(auth, email, password);
    // EMAIL VERIFICATION DISABLED — re-enable the lines below to send a
    // verification email and force sign-out until the user confirms their address.
    // await sendEmailVerification(cred.user);
    // await signOut(auth);
  };

  const signInWithGoogle = async () => {
    // Google accounts are pre-verified — no email verification needed
    await signInWithPopup(auth, googleProvider);
  };

  const sendPasswordReset = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  const logout = async () => {
    await signOut(auth);
    window.history.replaceState(null, "", "/");
  };

  return (
    <AuthContext.Provider value={{ user, role, loading, signIn, signUp, signInWithGoogle, sendPasswordReset, resendVerificationEmail, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

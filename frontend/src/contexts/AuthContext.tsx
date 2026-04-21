import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { auth } from "@/lib/firebase";

interface AuthContextValue {
  user: User | null;
  role: "user" | "admin" | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
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
        // TODO: if non-developer client admins are added, switch to
        // u.getIdTokenResult(true) to force-refresh on every auth state change,
        // so promotions/demotions are reflected immediately without a reload.
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

  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signUp = async (email: string, password: string) => {
    await createUserWithEmailAndPassword(auth, email, password);
    // Immediately sign out after account creation — the user should verify
    // their email and then sign in explicitly. This also ensures onUserCreate
    // has time to set the role claim before their first authenticated session.
    await signOut(auth);
  };

  const logout = async () => {
    await signOut(auth);
    // Clear URL to root so stale params don't persist after re-login
    window.history.replaceState(null, "", "/");
  };

  return (
    <AuthContext.Provider value={{ user, role, loading, signIn, signUp, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

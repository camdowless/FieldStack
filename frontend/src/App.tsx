import { useState, useEffect } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "./firebase";
import Auth from "./Auth";
import Dashboard from "./Dashboard";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  if (loading) return <div className="loading"><div className="spinner" /><span>Loading<span className="loading-dots" /></span></div>;
  return user ? <Dashboard /> : <Auth />;
}

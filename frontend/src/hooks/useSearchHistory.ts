import { useEffect, useState } from "react";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";

export interface SearchHistoryEntry {
  id: string;
  query: string;
  location: string;
  radius: number;
  resultCount: number;
  creditCost?: number;
  createdAt: { seconds: number } | null;
  cost?: {
    businessSearch: number;
    instantPages: number;
    lighthouse: number;
    totalDfs: number;
    firestoreReads: number;
    firestoreWrites: number;
    cachedBusinesses: number;
    freshBusinesses: number;
  } | null;
}

export function useSearchHistory() {
  const { user } = useAuth();
  const [searches, setSearches] = useState<SearchHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setSearches([]);
      setLoading(false);
      return;
    }

    const ref = collection(firestore, "users", user.uid, "searches");
    const q = query(ref, orderBy("createdAt", "desc"));

    const unsub = onSnapshot(q, (snap) => {
      const entries: SearchHistoryEntry[] = snap.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as Omit<SearchHistoryEntry, "id">),
      }));
      setSearches(entries);
      setLoading(false);
    });

    return unsub;
  }, [user]);

  return { searches, loading };
}

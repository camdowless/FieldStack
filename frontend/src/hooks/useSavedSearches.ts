import { useState, useEffect, useCallback } from "react";
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  deleteDoc,
  doc,
  getDocs,
  writeBatch,
} from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";

export interface FirestoreSavedSearch {
  id: string;
  query: string;
  location: string;
  category: string;
  radius: number;
  cids: string[];
  resultCount: number;
  createdAt: string; // ISO string derived from Firestore timestamp
}

export function useSavedSearches() {
  const { user, role } = useAuth();
  const [searches, setSearches] = useState<FirestoreSavedSearch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !role) {
      setSearches([]);
      setLoading(false);
      return;
    }

    const col = collection(firestore, "users", user.uid, "searches");
    const q = query(col, orderBy("createdAt", "desc"), limit(50));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const results: FirestoreSavedSearch[] = snap.docs.map((d) => {
          const data = d.data();
          // Convert Firestore Timestamp to ISO string
          const ts = data.createdAt?.toDate?.() ?? new Date();
          return {
            id: d.id,
            query: data.query ?? "",
            location: data.location ?? "",
            category: data.category ?? "",
            radius: data.radius ?? 10,
            cids: data.cids ?? [],
            resultCount: data.resultCount ?? 0,
            createdAt: ts.toISOString(),
          };
        });
        setSearches(results);
        setLoading(false);
      },
      (err) => {
        console.error("[useSavedSearches] snapshot error:", err);
        setLoading(false);
      },
    );

    return unsub;
  }, [user?.uid, role]);

  const deleteSearch = useCallback(
    async (searchId: string) => {
      if (!user) return;
      try {
        await deleteDoc(doc(firestore, "users", user.uid, "searches", searchId));
      } catch (err) {
        console.error("[useSavedSearches] delete failed:", err);
      }
    },
    [user],
  );

  const clearAllSearches = useCallback(async () => {
    if (!user) return;
    try {
      const col = collection(firestore, "users", user.uid, "searches");
      const snap = await getDocs(col);
      const batch = writeBatch(firestore);
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    } catch (err) {
      console.error("[useSavedSearches] clearAll failed:", err);
    }
  }, [user]);

  return { searches, loading, deleteSearch, clearAllSearches };
}

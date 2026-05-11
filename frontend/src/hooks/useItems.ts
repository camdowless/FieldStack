/**
 * useItems - real-time Firestore hook for the canonical Items example feature.
 *
 * Demonstrates the standard pattern for a Firestore-backed resource:
 * - Real-time subscription via onSnapshot
 * - Optimistic UI updates
 * - Full CRUD via Cloud Function API
 *
 * Copy and adapt this pattern for your own resources.
 */

import { useState, useEffect, useCallback } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { createItem, updateItem, deleteItem, type Item } from "@/lib/api";

interface UseItemsResult {
  items: Item[];
  loading: boolean;
  error: string | null;
  create: (params: { title: string; description?: string }) => Promise<void>;
  update: (id: string, params: { title?: string; description?: string; status?: "active" | "archived" }) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export function useItems(): UseItemsResult {
  const { user } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Real-time subscription
  useEffect(() => {
    if (!user) {
      setItems([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(firestore, "users", user.uid, "items"),
      orderBy("createdAt", "desc"),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const result: Item[] = snap.docs.map((d) => ({
          id: d.id,
          title: d.data().title ?? "",
          description: d.data().description ?? "",
          status: d.data().status ?? "active",
          createdAt: d.data().createdAt,
          updatedAt: d.data().updatedAt,
        }));
        setItems(result);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error("[useItems] snapshot error:", err);
        setError("Failed to load items.");
        setLoading(false);
      },
    );

    return () => unsub();
  // user?.uid is intentional - only re-subscribe when the user ID changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  const create = useCallback(async (params: { title: string; description?: string }) => {
    await createItem(params);
    // Firestore onSnapshot will update the list automatically
  }, []);

  const update = useCallback(async (id: string, params: { title?: string; description?: string; status?: "active" | "archived" }) => {
    await updateItem(id, params);
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteItem(id);
  }, []);

  return { items, loading, error, create, update, remove };
}

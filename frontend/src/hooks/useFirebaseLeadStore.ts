import { useState, useEffect, useCallback, useMemo } from "react";
import {
  collection,
  doc,
  query,
  orderBy,
  limit,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import type { Business, LeadStatus } from "@/data/mockBusinesses";

// ─── Firestore document shape ─────────────────────────────────────────────────

export interface SavedLeadDoc {
  cid: string;
  businessName: string;
  category: string;
  city: string;
  state: string;
  leadScore: number;
  label: string | null;
  legitimacyScore: number;
  status: LeadStatus;
  notes: string;
  notesEditedAt: string | null;
  savedAt: string;
  // Snapshot signals at save time
  hasWebsite: boolean;
  hasHttps: boolean;
  mobileFriendly: boolean;
  hasOnlineAds: boolean;
  seoScore: number;
  googleRating: number;
  reviewCount: number;
}

export const LEAD_STATUSES: { value: LeadStatus; label: string }[] = [
  { value: "saved", label: "Saved" },
  { value: "reached-out", label: "Reached Out" },
  { value: "in-conversation", label: "In Conversation" },
  { value: "proposal-sent", label: "Proposal Sent" },
  { value: "won", label: "Won" },
  { value: "not-interested", label: "Not Interested" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildLeadDoc(business: Business): Omit<SavedLeadDoc, "savedAt"> {
  const a = business.analysis;
  return {
    cid: business.id,
    businessName: business.name,
    category: business.category,
    city: business.city,
    state: business.state,
    leadScore: business.leadScore,
    label: business.label ?? null,
    legitimacyScore: business.legitimacyScore ?? 0,
    status: "saved",
    notes: "",
    notesEditedAt: null,
    hasWebsite: a.hasWebsite,
    hasHttps: a.hasHttps,
    mobileFriendly: a.mobileFriendly,
    hasOnlineAds: a.hasOnlineAds,
    seoScore: a.seoScore,
    googleRating: business.googleRating,
    reviewCount: business.reviewCount,
  };
}

function docToSavedLead(id: string, data: Record<string, unknown>): SavedLeadDoc {
  const ts = data.savedAt as Timestamp | null;
  const notesTs = data.notesEditedAt as Timestamp | null;
  return {
    cid: id,
    businessName: (data.businessName as string) ?? "",
    category: (data.category as string) ?? "",
    city: (data.city as string) ?? "",
    state: (data.state as string) ?? "",
    leadScore: (data.leadScore as number) ?? 0,
    label: (data.label as string) ?? null,
    legitimacyScore: (data.legitimacyScore as number) ?? 0,
    status: (data.status as LeadStatus) ?? "saved",
    notes: (data.notes as string) ?? "",
    notesEditedAt: notesTs?.toDate?.()?.toISOString() ?? null,
    savedAt: ts?.toDate?.()?.toISOString() ?? new Date().toISOString(),
    hasWebsite: (data.hasWebsite as boolean) ?? false,
    hasHttps: (data.hasHttps as boolean) ?? false,
    mobileFriendly: (data.mobileFriendly as boolean) ?? false,
    hasOnlineAds: (data.hasOnlineAds as boolean) ?? false,
    seoScore: (data.seoScore as number) ?? 0,
    googleRating: (data.googleRating as number) ?? 0,
    reviewCount: (data.reviewCount as number) ?? 0,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useFirebaseLeadStore() {
  const { user, role } = useAuth();
  const [leads, setLeads] = useState<SavedLeadDoc[]>([]);
  const [loading, setLoading] = useState(true);

  // Real-time listener on users/{uid}/savedLeads
  useEffect(() => {
    if (!user || !role) {
      setLeads([]);
      setLoading(false);
      return;
    }

    const col = collection(firestore, "users", user.uid, "savedLeads");
    const q = query(col, orderBy("savedAt", "desc"), limit(100));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const results = snap.docs.map((d) => docToSavedLead(d.id, d.data()));
        setLeads(results);
        setLoading(false);
      },
      (err) => {
        console.error("[useFirebaseLeadStore] snapshot error:", err);
        setLoading(false);
      },
    );

    return unsub;
  }, [user?.uid, role]);

  const savedLeadMap = useMemo(
    () => new Map(leads.map((l) => [l.cid, l])),
    [leads],
  );

  const isLeadSaved = useCallback(
    (cid: string) => savedLeadMap.has(cid),
    [savedLeadMap],
  );

  const getSavedLead = useCallback(
    (cid: string) => savedLeadMap.get(cid),
    [savedLeadMap],
  );

  const saveLead = useCallback(
    async (business: Business) => {
      if (!user) return;
      if (savedLeadMap.has(business.id)) return; // no duplicates
      const ref = doc(firestore, "users", user.uid, "savedLeads", business.id);
      const data = buildLeadDoc(business);
      await setDoc(ref, { ...data, savedAt: serverTimestamp() });
    },
    [user, savedLeadMap],
  );

  const removeLead = useCallback(
    async (cid: string) => {
      if (!user) return;
      await deleteDoc(doc(firestore, "users", user.uid, "savedLeads", cid));
    },
    [user],
  );

  const updateStatus = useCallback(
    async (cid: string, status: LeadStatus) => {
      if (!user) return;
      await updateDoc(doc(firestore, "users", user.uid, "savedLeads", cid), { status });
    },
    [user],
  );

  const updateNotes = useCallback(
    async (cid: string, notes: string) => {
      if (!user) return;
      await updateDoc(doc(firestore, "users", user.uid, "savedLeads", cid), {
        notes,
        notesEditedAt: serverTimestamp(),
      });
    },
    [user],
  );

  const updateScore = useCallback(
    async (cid: string, leadScore: number, label: string | null, signals?: {
      legitimacyScore?: number;
      hasWebsite?: boolean;
      hasHttps?: boolean;
      mobileFriendly?: boolean;
      hasOnlineAds?: boolean;
      seoScore?: number;
    }) => {
      if (!user) return;
      const ref = doc(firestore, "users", user.uid, "savedLeads", cid);
      await updateDoc(ref, { leadScore, label, ...signals }).catch(() => {
        // Not saved — no-op
      });
    },
    [user],
  );

  return {
    savedLeads: leads,
    loading,
    isLeadSaved,
    getSavedLead,
    saveLead,
    removeLead,
    updateStatus,
    updateNotes,
    updateScore,
  };
}

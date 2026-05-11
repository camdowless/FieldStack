import { useState, useEffect } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { useCompany } from "@/contexts/CompanyContext";
import type { LeadTimeSetting } from "@/types/fieldstack";

export function useLeadTimes(projectId?: string) {
  const { company } = useCompany();
  const [leadTimes, setLeadTimes] = useState<LeadTimeSetting[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!company) { setLeadTimes([]); setLoading(false); return; }

    const q = query(
      collection(firestore, "companies", company.id, "leadTimeSettings"),
      ...(projectId ? [where("projectId", "==", projectId)] : [where("isDefault", "==", true)])
    );

    const unsub = onSnapshot(q, (snap) => {
      setLeadTimes(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as LeadTimeSetting[]);
      setLoading(false);
    });

    return () => unsub();
  }, [company?.id, projectId]);

  return { leadTimes, loading };
}

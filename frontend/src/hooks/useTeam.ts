import { useState, useEffect } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { useCompany } from "@/contexts/CompanyContext";
import type { TeamMember } from "@/types/fieldstack";

export function useTeam() {
  const { company } = useCompany();
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!company) { setTeam([]); setLoading(false); return; }

    const q = query(
      collection(firestore, "companies", company.id, "teamMembers"),
      orderBy("createdAt", "asc")
    );

    const unsub = onSnapshot(q, (snap) => {
      setTeam(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as TeamMember[]);
      setLoading(false);
    });

    return () => unsub();
  }, [company?.id]);

  return { team, loading };
}

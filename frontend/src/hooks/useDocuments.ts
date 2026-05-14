/**
 * useDocuments — real-time Firestore subscription for project documents.
 *
 * Listens to companies/{companyId}/documents where projectId == projectId,
 * ordered by uploadedAt descending.
 */

import { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
} from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { useCompany } from "@/contexts/CompanyContext";
import type { ProjectDocument } from "@/types/fieldstack";

export function useDocuments(projectId: string | undefined) {
  const { company } = useCompany();
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!company?.id || !projectId) {
      setDocuments([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const docsCol = collection(firestore, `companies/${company.id}/documents`);
    const q = query(
      docsCol,
      where("projectId", "==", projectId),
      orderBy("uploadedAt", "desc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ProjectDocument));
        setDocuments(docs);
        setLoading(false);
      },
      (err) => {
        console.error("[useDocuments] snapshot error", err);
        setError(err.message);
        setLoading(false);
      }
    );

    return unsub;
  }, [company?.id, projectId]);

  return { documents, loading, error };
}

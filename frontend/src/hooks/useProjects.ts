import { useState, useEffect } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  doc,
} from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { useCompany } from "@/contexts/CompanyContext";
import type { Project } from "@/types/fieldstack";

export function useProjects() {
  const { company } = useCompany();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!company) {
      setProjects([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(firestore, "companies", company.id, "projects"),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const result: Project[] = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as Project[];
        setProjects(result);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error("[useProjects] snapshot error:", err);
        setError("Failed to load projects.");
        setLoading(false);
      }
    );

    return () => unsub();
  }, [company?.id]);

  return { projects, loading, error };
}

export function useProject(projectId: string | undefined) {
  const { company } = useCompany();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!company || !projectId) {
      setProject(null);
      setLoading(false);
      return;
    }

    const ref = doc(firestore, "companies", company.id, "projects", projectId);

    const unsub = onSnapshot(ref, (d) => {
      if (d.exists()) {
        setProject({ id: d.id, ...d.data() } as Project);
      } else {
        setProject(null);
      }
      setLoading(false);
    });

    return () => unsub();
  }, [company?.id, projectId]);

  return { project, loading };
}

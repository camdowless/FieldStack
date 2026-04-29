import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  listProjects,
  createProject,
  deleteProject,
  type CreateProjectInput,
} from "@/lib/fieldstackApi";

export function useProjects() {
  const { profile } = useAuth();
  const hasCompany = !!profile?.companyId;

  return useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    enabled: hasCompany,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) => createProject(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => deleteProject(projectId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

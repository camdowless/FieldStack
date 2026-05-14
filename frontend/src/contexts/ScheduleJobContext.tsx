/**
 * ScheduleJobContext — global tracker for in-flight schedule analysis jobs.
 *
 * Lifting upload state here (instead of ProjectDetail) means the job persists
 * when the user navigates away mid-analysis. Any screen can read job status
 * and show appropriate indicators.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { apiUploadSchedule } from "@/lib/fieldstackApi";

export interface ScheduleJob {
  projectId: string;
  projectName: string;
  /** ISO timestamp when the job started */
  startedAt: string;
  status: "running" | "done" | "error";
  result?: {
    tasksCreated: number;
    orderItemsCreated: number;
    version: number;
    changesDetected: number;
  };
  error?: string;
}

interface ScheduleJobContextValue {
  /** All jobs keyed by projectId — only one job per project at a time */
  jobs: Record<string, ScheduleJob>;
  /** Returns true if the given project has an active (running) job */
  isAnalyzing: (projectId: string) => boolean;
  /** Start an upload job for a project */
  startJob: (projectId: string, projectName: string, file: File) => Promise<void>;
  /** Dismiss a completed/errored job */
  dismissJob: (projectId: string) => void;
}

const ScheduleJobContext = createContext<ScheduleJobContextValue | null>(null);

export function ScheduleJobProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Record<string, ScheduleJob>>({});

  const isAnalyzing = useCallback(
    (projectId: string) => jobs[projectId]?.status === "running",
    [jobs]
  );

  const startJob = useCallback(
    async (projectId: string, projectName: string, file: File) => {
      const validExts = [".pdf", ".xlsx", ".xls", ".txt", ".csv"];
      if (!validExts.some((ext) => file.name.toLowerCase().endsWith(ext))) {
        toast.error("Unsupported file type. Use PDF, XLSX, or plain text.");
        return;
      }

      // Register the job as running
      setJobs((prev) => ({
        ...prev,
        [projectId]: {
          projectId,
          projectName,
          startedAt: new Date().toISOString(),
          status: "running",
        },
      }));

      try {
        const data = await apiUploadSchedule(projectId, file);

        setJobs((prev) => ({
          ...prev,
          [projectId]: {
            ...prev[projectId],
            status: "done",
            result: data,
          },
        }));

        toast.success(
          `${projectName}: schedule parsed — ${data.tasksCreated} tasks, ${data.orderItemsCreated} orders`
        );

        // Auto-dismiss after 8 seconds
        setTimeout(() => {
          setJobs((prev) => {
            const next = { ...prev };
            delete next[projectId];
            return next;
          });
        }, 8_000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";

        setJobs((prev) => ({
          ...prev,
          [projectId]: {
            ...prev[projectId],
            status: "error",
            error: msg,
          },
        }));

        toast.error(`${projectName}: ${msg}`);
      }
    },
    []
  );

  const dismissJob = useCallback((projectId: string) => {
    setJobs((prev) => {
      const next = { ...prev };
      delete next[projectId];
      return next;
    });
  }, []);

  return (
    <ScheduleJobContext.Provider value={{ jobs, isAnalyzing, startJob, dismissJob }}>
      {children}
    </ScheduleJobContext.Provider>
  );
}

export function useScheduleJobs() {
  const ctx = useContext(ScheduleJobContext);
  if (!ctx) throw new Error("useScheduleJobs must be used within ScheduleJobProvider");
  return ctx;
}

import { useEffect, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  limit,
} from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getProject, getProjectAlerts, updateProject, type ComputedAlert, type ProjectDetail } from "@/lib/fieldstackApi";

export interface TaskDoc {
  id: string;
  projectId: string;
  scheduleUploadId: string;
  taskName: string;
  building: string | null;
  floor: string | null;
  gcInstallDate: number; // ms
  gcInstallDateEnd: number | null;
  assignedResource: string | null;
  category: "CABINET_DELIVERY" | "CABINET_INSTALL" | "COUNTERTOP_SET" | "OTHER";
  isOurTask: boolean;
  createdAt: number;
}

export interface OrderItemDoc {
  id: string;
  projectId: string;
  taskId: string;
  itemType: "CABINETS_STANDARD" | "CABINETS_CUSTOM" | "COUNTERTOPS" | "HARDWARE";
  leadTimeWeeks: number;
  orderByDate: number; // ms
  orderedAt: number | null;
  poNumber: string | null;
  vendorName: string | null;
  notes: string | null;
  status: "NOT_ORDERED" | "ORDERED" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED";
  taskName: string;
  building: string | null;
  floor: string | null;
  gcInstallDate: number;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduleChangeDoc {
  id: string;
  projectId: string;
  taskId: string;
  taskName: string;
  building: string | null;
  floor: string | null;
  detectedAt: number;
  previousDate: number;
  newDate: number;
  shiftDays: number;
  notificationsSent: boolean;
}

export interface FeedEntryDoc {
  id: string;
  type: string;
  title: string;
  summary: string;
  createdAt: number;
  metadata: Record<string, unknown>;
}

export interface ScheduleUploadDoc {
  id: string;
  projectId: string;
  fileName: string;
  version: number;
  status: "PENDING" | "PARSING" | "DONE" | "FAILED";
  uploadedAt: number;
  parsedAt: number | null;
  parseResult: { tasksCreated: number; orderItemsCreated: number } | null;
  errorMessage: string | null;
}

function tsToMs(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === "number") return ts;
  // Firestore Timestamp shape from client SDK
  const t = ts as { seconds?: number; toMillis?: () => number };
  if (typeof t.toMillis === "function") return t.toMillis();
  if (typeof t.seconds === "number") return t.seconds * 1000;
  return 0;
}

export function useProjectDetail(projectId: string) {
  const [tasks, setTasks] = useState<TaskDoc[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItemDoc[]>([]);
  const [scheduleChanges, setScheduleChanges] = useState<ScheduleChangeDoc[]>([]);
  const [feedEntries, setFeedEntries] = useState<FeedEntryDoc[]>([]);
  const [scheduleUploads, setScheduleUploads] = useState<ScheduleUploadDoc[]>([]);
  const [liveLoading, setLiveLoading] = useState(true);

  const qc = useQueryClient();

  // Static project metadata (name, status, etc.)
  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId),
    staleTime: 30_000,
    enabled: !!projectId,
  });

  // Computed alerts (refreshed when orderItems change)
  const alertsQuery = useQuery({
    queryKey: ["project-alerts", projectId],
    queryFn: () => getProjectAlerts(projectId),
    staleTime: 60_000,
    enabled: !!projectId,
  });

  // Real-time listeners for sub-collections
  useEffect(() => {
    if (!projectId) return;
    setLiveLoading(true);

    const projectRef = doc(firestore, "projects", projectId);

    const unsubTasks = onSnapshot(
      query(collection(projectRef, "tasks"), orderBy("gcInstallDate", "asc")),
      (snap) => {
        setTasks(snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            projectId: data.projectId,
            scheduleUploadId: data.scheduleUploadId,
            taskName: data.taskName,
            building: data.building ?? null,
            floor: data.floor ?? null,
            gcInstallDate: tsToMs(data.gcInstallDate),
            gcInstallDateEnd: data.gcInstallDateEnd ? tsToMs(data.gcInstallDateEnd) : null,
            assignedResource: data.assignedResource ?? null,
            category: data.category,
            isOurTask: data.isOurTask,
            createdAt: tsToMs(data.createdAt),
          };
        }));
      }
    );

    const unsubOrders = onSnapshot(
      query(collection(projectRef, "orderItems"), orderBy("orderByDate", "asc")),
      (snap) => {
        setOrderItems(snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            projectId: data.projectId,
            taskId: data.taskId,
            itemType: data.itemType,
            leadTimeWeeks: data.leadTimeWeeks,
            orderByDate: tsToMs(data.orderByDate),
            orderedAt: data.orderedAt ? tsToMs(data.orderedAt) : null,
            poNumber: data.poNumber ?? null,
            vendorName: data.vendorName ?? null,
            notes: data.notes ?? null,
            status: data.status,
            taskName: data.taskName,
            building: data.building ?? null,
            floor: data.floor ?? null,
            gcInstallDate: tsToMs(data.gcInstallDate),
            createdAt: tsToMs(data.createdAt),
            updatedAt: tsToMs(data.updatedAt),
          };
        }));
        // Invalidate alerts query when order items change
        qc.invalidateQueries({ queryKey: ["project-alerts", projectId] });
      }
    );

    const unsubChanges = onSnapshot(
      query(collection(projectRef, "scheduleChanges"), orderBy("detectedAt", "desc"), limit(50)),
      (snap) => {
        setScheduleChanges(snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            projectId: data.projectId,
            taskId: data.taskId,
            taskName: data.taskName,
            building: data.building ?? null,
            floor: data.floor ?? null,
            detectedAt: tsToMs(data.detectedAt),
            previousDate: tsToMs(data.previousDate),
            newDate: tsToMs(data.newDate),
            shiftDays: data.shiftDays,
            notificationsSent: data.notificationsSent,
          };
        }));
      }
    );

    const unsubFeed = onSnapshot(
      query(collection(projectRef, "feedEntries"), orderBy("createdAt", "desc"), limit(30)),
      (snap) => {
        setFeedEntries(snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            type: data.type,
            title: data.title,
            summary: data.summary,
            createdAt: tsToMs(data.createdAt),
            metadata: data.metadata ?? {},
          };
        }));
      }
    );

    const unsubUploads = onSnapshot(
      query(collection(projectRef, "scheduleUploads"), orderBy("version", "desc")),
      (snap) => {
        setScheduleUploads(snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            projectId: data.projectId,
            fileName: data.fileName,
            version: data.version,
            status: data.status,
            uploadedAt: tsToMs(data.uploadedAt),
            parsedAt: data.parsedAt ? tsToMs(data.parsedAt) : null,
            parseResult: data.parseResult ?? null,
            errorMessage: data.errorMessage ?? null,
          };
        }));
        setLiveLoading(false);
      }
    );

    return () => {
      unsubTasks();
      unsubOrders();
      unsubChanges();
      unsubFeed();
      unsubUploads();
    };
  }, [projectId, qc]);

  const updateProjectMutation = useMutation({
    mutationFn: ({ data }: { data: Parameters<typeof updateProject>[1] }) =>
      updateProject(projectId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  return {
    project: projectQuery.data ?? null,
    projectLoading: projectQuery.isLoading,
    alerts: alertsQuery.data ?? [],
    alertsLoading: alertsQuery.isLoading,
    tasks,
    orderItems,
    scheduleChanges,
    feedEntries,
    scheduleUploads,
    liveLoading,
    updateProject: updateProjectMutation,
  };
}

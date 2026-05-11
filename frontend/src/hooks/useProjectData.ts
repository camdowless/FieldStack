/**
 * useProjectData — loads all sub-collections for a single project.
 * Tasks, OrderItems, ScheduleChanges, TaskSteps, FeedEntries.
 */

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
import type {
  Task,
  OrderItem,
  ScheduleChange,
  TaskStep,
  FeedEntry,
  Project,
} from "@/types/fieldstack";
import { computeAlerts, sortAlerts } from "@/lib/alerts";
import type { Alert } from "@/types/fieldstack";

export function useProjectData(projectId: string | undefined) {
  const { company } = useCompany();
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [changes, setChanges] = useState<ScheduleChange[]>([]);
  const [steps, setSteps] = useState<TaskStep[]>([]);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!company || !projectId) {
      setLoading(false);
      return;
    }

    const base = `companies/${company.id}/projects/${projectId}`;
    let resolved = 0;
    const total = 6;

    function tick() {
      resolved++;
      if (resolved >= total) setLoading(false);
    }

    // Project doc
    const projectUnsub = onSnapshot(doc(firestore, base), (snap) => {
      if (snap.exists()) setProject({ id: snap.id, ...snap.data() } as Project);
      tick();
    });

    // Tasks
    const tasksUnsub = onSnapshot(
      query(collection(firestore, `${base}/tasks`), orderBy("gcInstallDate", "asc")),
      (snap) => {
        setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Task[]);
        tick();
      }
    );

    // Order items
    const ordersUnsub = onSnapshot(
      query(collection(firestore, `${base}/orderItems`), orderBy("orderByDate", "asc")),
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as OrderItem[];
        setOrderItems(items);
        tick();
      }
    );

    // Schedule changes
    const changesUnsub = onSnapshot(
      query(collection(firestore, `${base}/scheduleChanges`), orderBy("detectedAt", "desc")),
      (snap) => {
        setChanges(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as ScheduleChange[]);
        tick();
      }
    );

    // Task steps
    const stepsUnsub = onSnapshot(
      query(collection(firestore, `${base}/taskSteps`), orderBy("dueDate", "asc")),
      (snap) => {
        setSteps(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as TaskStep[]);
        tick();
      }
    );

    // Feed entries
    const feedUnsub = onSnapshot(
      query(collection(firestore, `${base}/feedEntries`), orderBy("processedAt", "desc")),
      (snap) => {
        setFeed(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as FeedEntry[]);
        tick();
      }
    );

    return () => {
      projectUnsub();
      tasksUnsub();
      ordersUnsub();
      changesUnsub();
      stepsUnsub();
      feedUnsub();
    };
  }, [company?.id, projectId]);

  // Recompute alerts whenever orderItems change
  useEffect(() => {
    if (!project) return;
    const computed = computeAlerts(orderItems, project.name);
    setAlerts(sortAlerts(computed));
  }, [orderItems, project?.name]);

  return {
    project,
    tasks,
    orderItems,
    changes,
    steps,
    feed,
    alerts,
    loading,
    ourTasks: tasks.filter((t) => t.isOurTask),
    criticalAlerts: alerts.filter((a) => a.level === "CRITICAL"),
    warningAlerts: alerts.filter((a) => a.level === "WARNING"),
  };
}

import * as admin from "firebase-admin";
import type { OrderItemDoc, AlertLevel, ComputedAlert, ItemType, OrderStatus } from "./types";

const db = () => admin.firestore();

const ITEM_LABELS: Record<ItemType, string> = {
  CABINETS_STANDARD: "Cabinet order (standard)",
  CABINETS_CUSTOM: "Cabinet order (custom)",
  COUNTERTOPS: "Countertop order",
  HARDWARE: "Hardware order",
};

/**
 * Returns the alert level for an order item based on its order-by date and status.
 * Mirrors the logic in FieldStack-main/src/lib/alerts.ts.
 */
export function getAlertLevel(orderByDateMs: number, status: OrderStatus): AlertLevel {
  if (status === "DELIVERED" || status === "CANCELLED") return "ON_TRACK";
  if (status === "IN_TRANSIT" || status === "ORDERED") return "VERIFY";

  const today = Date.now();
  const days = Math.floor((orderByDateMs - today) / 86_400_000);

  if (days < 0) return "CRITICAL";
  if (days <= 14) return "WARNING";
  if (days <= 30) return "INFO";
  return "ON_TRACK";
}

/**
 * Computes alerts for all order items in a project.
 * Reads from /projects/{projectId}/orderItems (denormalized — no sub-queries needed).
 * Returns alerts sorted CRITICAL → WARNING → INFO → VERIFY → ON_TRACK.
 */
export async function computeProjectAlerts(projectId: string): Promise<ComputedAlert[]> {
  const snap = await db()
    .collection("projects")
    .doc(projectId)
    .collection("orderItems")
    .orderBy("orderByDate", "asc")
    .get();

  const levelOrder: Record<AlertLevel, number> = {
    CRITICAL: 0, WARNING: 1, INFO: 2, VERIFY: 3, ON_TRACK: 4,
  };

  const alerts: ComputedAlert[] = snap.docs.map((doc) => {
    const item = doc.data() as OrderItemDoc;
    const orderByDateMs = item.orderByDate.toMillis();
    const gcInstallDateMs = item.gcInstallDate.toMillis();
    const level = getAlertLevel(orderByDateMs, item.status);
    const daysUntilOrderBy = Math.floor((orderByDateMs - Date.now()) / 86_400_000);

    const location = [item.building, item.floor].filter(Boolean).join(" – ");
    const itemLabel = ITEM_LABELS[item.itemType];

    const title =
      level === "CRITICAL"
        ? `${itemLabel} OVERDUE — ${location}`
        : level === "WARNING"
        ? `${itemLabel} due soon — ${location}`
        : `${itemLabel} upcoming — ${location}`;

    const installDateStr = new Date(gcInstallDateMs).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
    const orderByDateStr = new Date(orderByDateMs).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
    const detail = `Install: ${installDateStr} · Order by: ${orderByDateStr} · Status: ${item.status.replace(/_/g, " ")}`;

    return {
      orderItemId: doc.id,
      taskId: item.taskId,
      level,
      title,
      detail,
      projectId,
      itemType: item.itemType,
      orderByDate: orderByDateMs,
      gcInstallDate: gcInstallDateMs,
      orderStatus: item.status,
      building: item.building,
      floor: item.floor,
      daysUntilOrderBy,
      taskName: item.taskName,
    };
  });

  return alerts.sort((a, b) => levelOrder[a.level] - levelOrder[b.level]);
}

/**
 * Returns just the CRITICAL and WARNING counts for a project.
 * Used by listProjects to build the dashboard summary row without returning full alert details.
 */
export async function computeAlertCountsForProject(
  projectId: string
): Promise<{ critical: number; warning: number; info: number }> {
  const snap = await db()
    .collection("projects")
    .doc(projectId)
    .collection("orderItems")
    .get();

  let critical = 0;
  let warning = 0;
  let info = 0;

  for (const doc of snap.docs) {
    const item = doc.data() as OrderItemDoc;
    const level = getAlertLevel(item.orderByDate.toMillis(), item.status);
    if (level === "CRITICAL") critical++;
    else if (level === "WARNING") warning++;
    else if (level === "INFO") info++;
  }

  return { critical, warning, info };
}

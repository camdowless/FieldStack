/**
 * Alert computation — pure client-side logic.
 * Mirrors the old app's alerts.ts but works with Firestore Timestamps.
 */

import { differenceInDays } from "date-fns";
import type { Alert, AlertLevel, OrderItem, OrderStatus } from "@/types/fieldstack";
import { Timestamp } from "firebase/firestore";

export function getAlertLevel(orderByDate: Date, status: OrderStatus): AlertLevel {
  if (status === "DELIVERED" || status === "CANCELLED") return "ON_TRACK";
  if (status === "IN_TRANSIT") return "VERIFY";
  if (status === "ORDERED") return "VERIFY";

  const today = new Date();
  const days = differenceInDays(orderByDate, today);

  if (days < 0) return "CRITICAL";
  if (days <= 14) return "WARNING";
  if (days <= 30) return "INFO";
  return "ON_TRACK";
}

export function alertColor(level: AlertLevel): string {
  return {
    CRITICAL: "#f87171",
    WARNING: "#fbbf24",
    INFO: "#93c5fd",
    VERIFY: "#6ee7b7",
    ON_TRACK: "#6ee7b7",
  }[level] ?? "#6b7280";
}

export function alertVariant(level: AlertLevel): "destructive" | "secondary" | "outline" | "default" {
  if (level === "CRITICAL") return "destructive";
  if (level === "WARNING") return "secondary";
  return "outline";
}

export function computeAlerts(
  orderItems: OrderItem[],
  projectName: string
): Alert[] {
  return orderItems.map((item) => {
    const orderByDate =
      item.orderByDate instanceof Timestamp
        ? item.orderByDate.toDate()
        : new Date(item.orderByDate as unknown as string);

    const installDate =
      item.gcInstallDate instanceof Timestamp
        ? item.gcInstallDate.toDate()
        : new Date(item.gcInstallDate as unknown as string);

    const level = getAlertLevel(orderByDate, item.status);
    const daysUntilOrderBy = differenceInDays(orderByDate, new Date());

    const itemLabel: Record<string, string> = {
      CABINETS_STANDARD: "Cabinet order (standard)",
      CABINETS_CUSTOM: "Cabinet order (custom)",
      COUNTERTOPS: "Countertop order",
      HARDWARE: "Hardware order",
    };

    const location = [item.building, item.floor].filter(Boolean).join(" – ");
    const label = itemLabel[item.itemType] ?? item.itemType;

    const title =
      level === "CRITICAL"
        ? `${label} OVERDUE — ${location}`
        : level === "WARNING"
        ? `${label} due soon — ${location}`
        : `${label} upcoming — ${location}`;

    const detail = `Install: ${installDate.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })} · Order by: ${orderByDate.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })} · Status: ${item.status.replace(/_/g, " ")}`;

    return {
      id: item.id,
      level,
      title,
      detail,
      projectId: item.projectId,
      projectName,
      taskId: item.taskId,
      orderItemId: item.id,
      installDate: item.gcInstallDate ?? item.orderByDate,
      orderByDate: item.orderByDate,
      orderStatus: item.status,
      building: item.building,
      floor: item.floor,
      itemType: item.itemType,
      daysUntilOrderBy,
    } as Alert;
  });
}

export function sortAlerts(alerts: Alert[]): Alert[] {
  const order: Record<AlertLevel, number> = {
    CRITICAL: 0,
    WARNING: 1,
    INFO: 2,
    VERIFY: 3,
    ON_TRACK: 4,
  };
  return [...alerts].sort((a, b) => order[a.level] - order[b.level]);
}

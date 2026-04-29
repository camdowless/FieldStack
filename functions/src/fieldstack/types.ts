import { Timestamp } from "firebase-admin/firestore";

// ─── Enums ────────────────────────────────────────────────────────────────────

export type ProjectStatus = "ACTIVE" | "ON_HOLD" | "COMPLETE";
export type TaskCategory = "CABINET_DELIVERY" | "CABINET_INSTALL" | "COUNTERTOP_SET" | "OTHER";
export type ItemType = "CABINETS_STANDARD" | "CABINETS_CUSTOM" | "COUNTERTOPS" | "HARDWARE";
export type OrderStatus = "NOT_ORDERED" | "ORDERED" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED";
export type AlertLevel = "CRITICAL" | "WARNING" | "INFO" | "ON_TRACK" | "VERIFY";
export type UploadStatus = "PENDING" | "PARSING" | "DONE" | "FAILED";

// ─── Firestore Documents ───────────────────────────────────────────────────────

export interface CompanyDoc {
  name: string;
  slug: string;
  ownerUid: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ProjectDoc {
  companyId: string;
  name: string;
  address: string;
  gcName: string;
  gcContact: string | null;
  gcEmail: string | null;
  status: ProjectStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ScheduleUploadDoc {
  projectId: string;
  fileName: string;
  rawText: string;           // "" for PDFs; extracted CSV text for XLSX/text uploads
  storagePath: string | null; // Firebase Storage path for all uploads
  version: number;
  uploadedAt: Timestamp;
  parsedAt: Timestamp | null;
  status: UploadStatus;
  parseResult: { tasksCreated: number; orderItemsCreated: number } | null;
  errorMessage: string | null;
}

export interface TaskDoc {
  projectId: string;
  scheduleUploadId: string;
  taskIdOriginal: string | null;
  taskName: string;
  building: string | null;
  floor: string | null;
  gcInstallDate: Timestamp;
  gcInstallDateEnd: Timestamp | null;
  assignedResource: string | null;
  category: TaskCategory;
  isOurTask: boolean;
  createdAt: Timestamp;
}

export interface OrderItemDoc {
  projectId: string;
  taskId: string;
  itemType: ItemType;
  leadTimeWeeks: number;
  orderByDate: Timestamp;
  orderedAt: Timestamp | null;
  poNumber: string | null;
  vendorName: string | null;
  notes: string | null;
  status: OrderStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  // Denormalized from task for alert queries without joins
  taskName: string;
  building: string | null;
  floor: string | null;
  gcInstallDate: Timestamp;
}

export interface ScheduleChangeDoc {
  projectId: string;
  taskId: string;
  taskName: string;
  building: string | null;
  floor: string | null;
  detectedAt: Timestamp;
  previousDate: Timestamp;
  newDate: Timestamp;
  shiftDays: number;
  notificationsSent: boolean;
}

export interface FeedEntryDoc {
  type: string;
  title: string;
  summary: string;
  createdAt: Timestamp;
  metadata: Record<string, unknown>;
}

export interface UsageLogDoc {
  companyId: string;
  action: string;
  model: string;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  costUsd: number;
  createdAt: Timestamp;
}

// ─── Computed / Response Types ────────────────────────────────────────────────

export interface ComputedAlert {
  orderItemId: string;
  taskId: string;
  level: AlertLevel;
  title: string;
  detail: string;
  projectId: string;
  itemType: ItemType;
  orderByDate: number; // ms epoch
  gcInstallDate: number; // ms epoch
  orderStatus: OrderStatus;
  building: string | null;
  floor: string | null;
  daysUntilOrderBy: number;
  taskName: string;
}

export interface ProjectSummary {
  id: string;
  companyId: string;
  name: string;
  address: string;
  gcName: string;
  gcContact: string | null;
  gcEmail: string | null;
  status: ProjectStatus;
  createdAt: number; // ms epoch
  updatedAt: number; // ms epoch
  alertCounts: { critical: number; warning: number; info: number };
  latestUpload: { version: number; uploadedAt: number; status: UploadStatus } | null;
}

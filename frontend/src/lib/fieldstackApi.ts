import { getAuthToken, ApiError } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProjectStatus = "ACTIVE" | "ON_HOLD" | "COMPLETE";
export type ItemType = "CABINETS_STANDARD" | "CABINETS_CUSTOM" | "COUNTERTOPS" | "HARDWARE";
export type OrderStatus = "NOT_ORDERED" | "ORDERED" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED";
export type AlertLevel = "CRITICAL" | "WARNING" | "INFO" | "ON_TRACK" | "VERIFY";
export type UploadStatus = "PENDING" | "PARSING" | "DONE" | "FAILED";

export interface ProjectSummary {
  id: string;
  companyId: string;
  name: string;
  address: string;
  gcName: string;
  gcContact: string | null;
  gcEmail: string | null;
  status: ProjectStatus;
  createdAt: number;
  updatedAt: number;
  alertCounts: { critical: number; warning: number; info: number };
  latestUpload: { version: number; uploadedAt: number; status: UploadStatus } | null;
}

export interface ProjectDetail extends ProjectSummary {
  // Full project returned by getProject — same shape as summary for now
}

export interface ComputedAlert {
  orderItemId: string;
  taskId: string;
  level: AlertLevel;
  title: string;
  detail: string;
  projectId: string;
  itemType: ItemType;
  orderByDate: number;
  gcInstallDate: number;
  orderStatus: OrderStatus;
  building: string | null;
  floor: string | null;
  daysUntilOrderBy: number;
  taskName: string;
}

export interface CreateProjectInput {
  name: string;
  address: string;
  gcName: string;
  gcContact?: string;
  gcEmail?: string;
}

export interface UpdateOrderItemInput {
  status?: OrderStatus;
  poNumber?: string;
  vendorName?: string;
  notes?: string;
  orderedAt?: number;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

// In dev, call the Functions emulator directly (bypasses Vite proxy path issues).
// In production, use relative paths resolved via Firebase Hosting rewrites.
const EMULATOR_BASE = import.meta.env.DEV
  ? `http://127.0.0.1:5001/${import.meta.env.VITE_FIREBASE_PROJECT_ID}/us-central1`
  : null;

function buildUrl(path: string): string {
  if (!EMULATOR_BASE) return path;
  // path is like "/api/fieldstack/provisionCompany" — extract the function name
  const fnName = path.split("/").pop()!;
  return `${EMULATOR_BASE}/${fnName}`;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getAuthToken();
  if (!token) throw new ApiError("You must be signed in.", 401, false);

  const res = await fetch(buildUrl(path), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const msg = typeof body?.error === "string" ? body.error : `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, res.status >= 500);
  }

  return res.json();
}

// ─── Company ──────────────────────────────────────────────────────────────────

export async function provisionCompany(companyName: string): Promise<{ companyId: string }> {
  return apiFetch("/api/fieldstack/provisionCompany", {
    method: "POST",
    body: JSON.stringify({ companyName }),
  });
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export async function listProjects(): Promise<ProjectSummary[]> {
  const data = await apiFetch<{ projects: ProjectSummary[] }>("/api/fieldstack/listProjects");
  return data.projects;
}

export async function createProject(input: CreateProjectInput): Promise<{ id: string }> {
  return apiFetch("/api/fieldstack/createProject", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getProject(projectId: string): Promise<ProjectDetail> {
  const data = await apiFetch<{ project: ProjectDetail }>(
    `/api/fieldstack/getProject?projectId=${encodeURIComponent(projectId)}`
  );
  return data.project;
}

export async function updateProject(
  projectId: string,
  data: Partial<CreateProjectInput & { status: ProjectStatus }>
): Promise<void> {
  await apiFetch("/api/fieldstack/updateProject", {
    method: "POST",
    body: JSON.stringify({ projectId, ...data }),
  });
}

export async function deleteProject(projectId: string): Promise<void> {
  await apiFetch("/api/fieldstack/deleteProject", {
    method: "POST",
    body: JSON.stringify({ projectId }),
  });
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

export async function getProjectAlerts(projectId: string): Promise<ComputedAlert[]> {
  const data = await apiFetch<{ alerts: ComputedAlert[] }>(
    `/api/fieldstack/getProjectAlerts?projectId=${encodeURIComponent(projectId)}`
  );
  return data.alerts;
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export async function updateOrderItem(
  orderItemId: string,
  projectId: string,
  data: UpdateOrderItemInput
): Promise<void> {
  await apiFetch("/api/fieldstack/updateOrderItem", {
    method: "POST",
    body: JSON.stringify({ orderItemId, projectId, ...data }),
  });
}

// ─── Schedule Upload ──────────────────────────────────────────────────────────

export interface UploadResult {
  uploadId: string;
  version: number;
  tasksCreated: number;
  orderItemsCreated: number;
  alertCount: number;
}

/**
 * Triggers parsing of a file already uploaded to Firebase Storage.
 * The frontend uploads the file to Storage first, then calls this with the storagePath.
 */
export async function triggerScheduleParse(
  projectId: string,
  storagePath: string,
  fileName: string
): Promise<UploadResult> {
  const data = await apiFetch<UploadResult>("/api/fieldstack/uploadSchedule", {
    method: "POST",
    body: JSON.stringify({ projectId, storagePath, fileName }),
  });
  return data;
}

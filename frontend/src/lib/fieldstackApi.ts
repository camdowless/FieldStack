/**
 * FieldStack API client — all calls to Cloud Functions.
 * Mirrors the old Next.js API routes, now as Firebase Cloud Function calls.
 */

import { getAuthToken, ApiError } from "@/lib/api";

// ─── Base helper ──────────────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getAuthToken();
  if (!token) throw new ApiError("You must be signed in.", 401, false);

  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const msg = typeof body?.error === "string" ? body.error : `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, res.status >= 500);
  }

  return res.json();
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export async function apiCreateProject(data: {
  name: string;
  address: string;
  gcName: string;
  gcContact?: string;
  gcEmail?: string;
  gcPlatform?: string;
}): Promise<{ id: string }> {
  return apiFetch("/api/projects", { method: "POST", body: JSON.stringify(data) });
}

export async function apiUpdateProject(
  id: string,
  data: Partial<{ name: string; address: string; gcName: string; gcContact: string; gcEmail: string; status: string; gcPlatform: string; autoSyncEnabled: boolean }>
): Promise<void> {
  return apiFetch(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function apiDeleteProject(id: string): Promise<void> {
  return apiFetch(`/api/projects/${id}`, { method: "DELETE" });
}

// ─── Schedule Upload ──────────────────────────────────────────────────────────

export async function apiUploadSchedule(
  projectId: string,
  file: File
): Promise<{ tasksCreated: number; orderItemsCreated: number; version: number; changesDetected: number }> {
  const token = await getAuthToken();
  if (!token) throw new ApiError("You must be signed in.", 401, false);

  const fd = new FormData();
  fd.append("file", file);
  fd.append("projectId", projectId);

  const res = await fetch("/api/schedules/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body?.error ?? `Upload failed (${res.status})`, res.status, res.status >= 500);
  }

  return res.json();
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export async function apiUpdateOrder(
  id: string,
  data: Partial<{
    status: string;
    poNumber: string;
    vendorName: string;
    notes: string;
    orderedAt: string;
  }>
): Promise<void> {
  return apiFetch(`/api/orders/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

export async function apiSendAlerts(projectId: string): Promise<{
  alerts: number;
  changes: number;
  resendConfigured: boolean;
}> {
  return apiFetch(`/api/alerts/send`, {
    method: "POST",
    body: JSON.stringify({ projectId }),
  });
}

export async function apiSendAlertToMember(params: {
  email: string;
  alert: object;
  projectId: string;
}): Promise<void> {
  return apiFetch("/api/alerts/send-to-member", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

export async function apiChat(params: {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<{ reply: string; requiresConfirmation?: boolean; pendingAction?: object }> {
  return apiFetch("/api/chat", { method: "POST", body: JSON.stringify(params) });
}

export async function apiGetChatHistory(): Promise<
  Array<{ role: "user" | "assistant"; content: string; id: string }>
> {
  return apiFetch("/api/chat");
}

// ─── Briefing ─────────────────────────────────────────────────────────────────

export async function apiGetBriefing(): Promise<{
  date: string;
  activeProjects: number;
  overdue: object[];
  upcoming: object[];
  recentChanges: object[];
  ordersNeeded: object[];
}> {
  return apiFetch("/api/briefing");
}

// ─── Feed ─────────────────────────────────────────────────────────────────────

export async function apiGetFeed(projectId?: string): Promise<object[]> {
  const qs = projectId ? `?projectId=${projectId}` : "";
  return apiFetch(`/api/feed${qs}`);
}

// ─── Gmail ────────────────────────────────────────────────────────────────────

export async function apiGetGmailStatus(): Promise<{
  connected: boolean;
  email?: string;
  lastSyncAt?: string;
}> {
  return apiFetch("/api/gmail");
}

export async function apiScanGmail(hoursBack = 24): Promise<{
  processed: number;
  saved: number;
  skipped: number;
}> {
  return apiFetch("/api/gmail/scan", {
    method: "POST",
    body: JSON.stringify({ hoursBack }),
  });
}

export async function apiDisconnectGmail(): Promise<void> {
  return apiFetch("/api/gmail", { method: "DELETE" });
}

// ─── Team ─────────────────────────────────────────────────────────────────────

export async function apiCreateTeamMember(data: {
  name: string;
  email: string;
  role: string;
  notifyOnCritical?: boolean;
  notifyOnOrderReminder?: boolean;
  notifyOnScheduleChange?: boolean;
}): Promise<{ id: string }> {
  return apiFetch("/api/team", { method: "POST", body: JSON.stringify(data) });
}

export async function apiUpdateTeamMember(
  id: string,
  data: Partial<{
    name: string;
    email: string;
    role: string;
    notifyOnCritical: boolean;
    notifyOnOrderReminder: boolean;
    notifyOnScheduleChange: boolean;
  }>
): Promise<void> {
  return apiFetch(`/api/team/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function apiDeleteTeamMember(id: string): Promise<void> {
  return apiFetch(`/api/team/${id}`, { method: "DELETE" });
}

// ─── Lead Times ───────────────────────────────────────────────────────────────

export async function apiUpdateLeadTimes(
  settings: Array<{ itemType: string; leadTimeWeeks: number; projectId?: string }>
): Promise<void> {
  return apiFetch("/api/settings/lead-times", {
    method: "PATCH",
    body: JSON.stringify({ settings }),
  });
}

// ─── Procore ──────────────────────────────────────────────────────────────────

export async function apiGetProcoreAuthUrl(projectId: string): Promise<{ url: string }> {
  return apiFetch(`/api/procore/auth-url?projectId=${projectId}`);
}

export async function apiSyncProcore(projectId: string): Promise<{
  tasksCreated: number;
  tasksUpdated: number;
}> {
  return apiFetch("/api/procore/sync", {
    method: "POST",
    body: JSON.stringify({ projectId }),
  });
}

// ─── SMS Briefing ─────────────────────────────────────────────────────────────

export async function apiSendSmsBriefing(phoneNumber: string): Promise<{ sent: boolean }> {
  return apiFetch("/api/sms-briefing", {
    method: "POST",
    body: JSON.stringify({ phoneNumber }),
  });
}

// ─── My Tasks ─────────────────────────────────────────────────────────────────

export async function apiGetMyTasks(): Promise<object[]> {
  return apiFetch("/api/my-tasks");
}

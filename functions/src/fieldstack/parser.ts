import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import Anthropic from "@anthropic-ai/sdk";
import * as XLSX from "xlsx";
import type { TaskCategory, TaskDoc, OrderItemDoc, ScheduleChangeDoc, UsageLogDoc } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

const LEAD_TIME_CABINETS_WEEKS = 8;
const LEAD_TIME_COUNTERTOPS_WEEKS = 8;
const TEXT_CHUNK_SIZE = 12_000;

const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
};
const DEFAULT_PRICE = { input: 3, output: 15 };

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedTask {
  taskIdOriginal?: string;
  taskName: string;
  building?: string;
  floor?: string;
  startDate: string;
  endDate?: string;
  assignedResource?: string;
  isOurTask: boolean;
}

// ─── System Prompt (verbatim from FieldStack-main/src/lib/parser.ts) ──────────

const SYSTEM_PROMPT = `You are a construction schedule parser for a cabinet and countertop subcontractor.

Extract ALL tasks from this construction schedule page. Include every trade — nothing should be skipped.

For each task, set "isOurTask" to true ONLY if the task is related to cabinets, countertops, or backsplash (assigned to CKF, BAM, or explicitly mentions cabinets/countertops). All other tasks should have "isOurTask" false.

CRITICAL: You MUST extract the start and end dates for every task. Look at the column headers to identify which columns contain dates. Dates may appear as "Apr 1", "04/01/26", "Mar 23, 2026", or as date ranges in Gantt-style bars. Normalize all dates to YYYY-MM-DD format. If the year is not shown, infer it from context (header, title, or assume current/next year). Tasks without any identifiable date should still be included with startDate set to the best estimate.

Return ONLY a valid JSON array. No prose, no markdown fences, no explanation.

Each object: {"taskIdOriginal":"ID or null","taskName":"exact name","building":"Building X or null","floor":"Floor Y or null","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD or null","assignedResource":"company or null","isOurTask":false}`;

// ─── Anthropic Client (singleton) ─────────────────────────────────────────────

const anthropicClient = new Anthropic({ timeout: 180_000 });

// ─── Exported Utilities ───────────────────────────────────────────────────────

// Claude vision extracts the same building with inconsistent casing across pages
// ("Building 7" vs "BUILDING 7"). Normalize so dedup + diff matching treats them
// as the same. Applied at save-time so DB is canonical, and at dedup-key time.
export function normalizeLabel(s: string | null | undefined): string | null {
  if (!s) return null;
  const trimmed = s.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.replace(/\b([a-zA-Z])([a-zA-Z]*)/g, (_, first, rest) =>
    first.toUpperCase() + rest.toLowerCase()
  );
}

export function categorizeTask(taskName: string, resource: string | null): TaskCategory {
  const name = taskName.toLowerCase();
  const res = (resource || "").toLowerCase();

  if (name.includes("cabinet") && name.includes("deliver")) return "CABINET_DELIVERY";
  if (name.includes("cabinet") && name.includes("install")) return "CABINET_INSTALL";
  if (name.includes("countertop") || name.includes("backsplash") || name.includes("set counter"))
    return "COUNTERTOP_SET";
  if (res === "ckf") {
    if (name.includes("deliver")) return "CABINET_DELIVERY";
    if (name.includes("set") || name.includes("counter")) return "COUNTERTOP_SET";
  }
  return "OTHER";
}

export function xlsxBufferToText(buffer: Buffer): string {
  const wb = XLSX.read(buffer, { type: "buffer" });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    return XLSX.utils.sheet_to_csv(ws);
  }).join("\n\n");
}

export function deduplicateTasks(tasks: ParsedTask[]): ParsedTask[] {
  const seen = new Set<string>();
  return tasks.filter((t) => {
    const key = `${t.taskName}|${normalizeLabel(t.building) ?? ""}|${normalizeLabel(t.floor) ?? ""}|${t.startDate ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

async function callClaude(params: {
  companyId: string;
  action: string;
  model: string;
  max_tokens: number;
  system: string;
  messages: Anthropic.Messages.MessageParam[];
}): Promise<Anthropic.Messages.Message> {
  const { companyId, action, model, ...rest } = params;
  const response = await anthropicClient.messages.create({ model, ...rest });

  // Fire-and-forget usage log
  const usage = response.usage as Anthropic.Messages.Usage & {
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const prices = MODEL_PRICES[model] ?? DEFAULT_PRICE;
  const costUsd =
    (usage.input_tokens * prices.input +
      cacheWrite * prices.input * 1.25 +
      cacheRead * prices.input * 0.1 +
      usage.output_tokens * prices.output) /
    1_000_000;

  const logDoc: Omit<UsageLogDoc, "createdAt"> & { createdAt: FieldValue } = {
    companyId,
    action,
    model,
    inputTokens: usage.input_tokens,
    cacheWriteTokens: cacheWrite,
    cacheReadTokens: cacheRead,
    outputTokens: usage.output_tokens,
    costUsd,
    createdAt: FieldValue.serverTimestamp(),
  };
  admin
    .firestore()
    .collection("companies")
    .doc(companyId)
    .collection("usageLogs")
    .add(logDoc)
    .catch((err) => console.error("[parser] usage-log write failed:", err));

  return response;
}

function extractJsonFromResponse(
  response: Anthropic.Messages.Message,
  truncated: boolean
): ParsedTask[] {
  let text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  if (truncated) {
    console.warn("[parser] Response truncated — salvaging partial JSON");
    text = text.replace(/,\s*$/, "");
    const opens = (text.match(/{/g) ?? []).length;
    const closes = (text.match(/}/g) ?? []).length;
    text += "}".repeat(Math.max(0, opens - closes));
    if (!text.trimEnd().endsWith("]")) text += "]";
  }

  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned) as ParsedTask[];
  } catch {
    console.warn("[parser] Invalid JSON from Claude:", cleaned.slice(0, 200));
    return [];
  }
}

// ─── PDF Vision Parser ────────────────────────────────────────────────────────

export async function parseScheduleWithVision(
  pdfBuffer: Buffer,
  companyId: string
): Promise<ParsedTask[]> {
  const base64 = pdfBuffer.toString("base64");
  console.log("[parser] PDF vision: single-call extraction");

  const response = await callClaude({
    companyId,
    action: "parse_schedule_pdf_vision",
    model: "claude-sonnet-4-6",
    max_tokens: 16384,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: base64 },
            cache_control: { type: "ephemeral" },
          } as Anthropic.Messages.DocumentBlockParam,
          {
            type: "text",
            text: "Extract ALL tasks from ALL pages of this construction schedule. Return the complete JSON array.",
          },
        ],
      },
    ],
  });

  const truncated = response.stop_reason === "max_tokens";
  const tasks = extractJsonFromResponse(response, truncated);

  if (truncated) {
    console.warn("[parser] Single-call truncated — switching to page-batched extraction");
    return parseScheduleWithVisionBatched(base64, companyId);
  }

  console.log(`[parser] Single-call extracted ${tasks.length} tasks`);
  return tasks;
}

async function parseScheduleWithVisionBatched(
  base64: string,
  companyId: string
): Promise<ParsedTask[]> {
  const countResponse = await callClaude({
    companyId,
    action: "parse_schedule_pdf_page_count",
    model: "claude-sonnet-4-6",
    max_tokens: 100,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: base64 },
            cache_control: { type: "ephemeral" },
          } as Anthropic.Messages.DocumentBlockParam,
          { type: "text", text: "How many pages does this PDF have? Reply with ONLY the number." },
        ],
      },
    ],
  });

  const pageCount =
    parseInt(
      countResponse.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim()
    ) || 1;
  console.log(`[parser] Batched extraction: ${pageCount} pages`);

  const allTasks: ParsedTask[] = [];
  const BATCH_SIZE = 5;

  for (let i = 0; i < pageCount; i += BATCH_SIZE) {
    const batch: Promise<ParsedTask[]>[] = [];
    for (let j = i; j < Math.min(i + BATCH_SIZE, pageCount); j++) {
      const pageNum = j + 1;
      batch.push(
        callClaude({
          companyId,
          action: "parse_schedule_pdf_page",
          model: "claude-sonnet-4-6",
          max_tokens: 16384,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "document",
                  source: { type: "base64", media_type: "application/pdf", data: base64 },
                  cache_control: { type: "ephemeral" },
                } as Anthropic.Messages.DocumentBlockParam,
                {
                  type: "text",
                  text: `Extract ALL tasks from page ${pageNum} of this construction schedule. Return the JSON array.`,
                },
              ],
            },
          ],
        }).then((resp) => extractJsonFromResponse(resp, resp.stop_reason === "max_tokens"))
      );
    }
    const results = await Promise.all(batch);
    for (const pageTasks of results) allTasks.push(...pageTasks);
  }

  return allTasks;
}

// ─── Text Parser ──────────────────────────────────────────────────────────────

export async function parseScheduleWithText(
  rawText: string,
  companyId: string
): Promise<ParsedTask[]> {
  const allTasks: ParsedTask[] = [];

  if (rawText.length <= TEXT_CHUNK_SIZE) {
    allTasks.push(...(await callClaudeText(rawText, companyId)));
  } else {
    const pages = rawText
      .split(/===\s*Page\s+\d+.*?===/)
      .filter((p) => p.trim().length > 50);

    if (pages.length > 1) {
      for (let i = 0; i < pages.length; i++) {
        console.log(`[parser] Text chunk ${i + 1}/${pages.length}`);
        allTasks.push(...(await callClaudeText(pages[i], companyId)));
      }
    } else {
      for (let i = 0; i < rawText.length; i += TEXT_CHUNK_SIZE) {
        console.log(`[parser] Text chunk ${Math.floor(i / TEXT_CHUNK_SIZE) + 1}`);
        allTasks.push(...(await callClaudeText(rawText.slice(i, i + TEXT_CHUNK_SIZE), companyId)));
      }
    }
  }

  return allTasks;
}

async function callClaudeText(text: string, companyId: string): Promise<ParsedTask[]> {
  const response = await callClaude({
    companyId,
    action: "parse_schedule_text",
    model: "claude-haiku-4-5-20251001",
    max_tokens: 16384,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Parse this construction schedule and return the JSON array:\n\n${text}`,
      },
    ],
  });
  return extractJsonFromResponse(response, response.stop_reason === "max_tokens");
}

// ─── Save to Firestore ────────────────────────────────────────────────────────

export async function saveParsedTasks(
  tasks: ParsedTask[],
  projectId: string,
  uploadId: string
): Promise<{ tasksCreated: number; orderItemsCreated: number }> {
  const db = admin.firestore();
  const now = FieldValue.serverTimestamp();

  // Find the previous upload (not the current one) for schedule change detection
  const uploadsSnap = await db
    .collection("projects")
    .doc(projectId)
    .collection("scheduleUploads")
    .orderBy("version", "desc")
    .limit(2)
    .get();

  const prevUploadDoc = uploadsSnap.docs.find((d) => d.id !== uploadId) ?? null;

  // Index previous tasks by dedup key for O(1) diff lookup
  const prevTasksByKey = new Map<string, { gcInstallDate: admin.firestore.Timestamp }>();
  if (prevUploadDoc) {
    const prevTasksSnap = await db
      .collection("projects")
      .doc(projectId)
      .collection("tasks")
      .where("scheduleUploadId", "==", prevUploadDoc.id)
      .get();
    for (const doc of prevTasksSnap.docs) {
      const data = doc.data();
      const key = `${data.taskName}|${normalizeLabel(data.building) ?? ""}|${normalizeLabel(data.floor) ?? ""}`;
      prevTasksByKey.set(key, { gcInstallDate: data.gcInstallDate });
    }
    console.log(`[parser] Loaded ${prevTasksByKey.size} previous tasks for diff`);
  }

  const tasksRef = db.collection("projects").doc(projectId).collection("tasks");
  const orderItemsRef = db.collection("projects").doc(projectId).collection("orderItems");
  const changesRef = db.collection("projects").doc(projectId).collection("scheduleChanges");

  let tasksCreated = 0;
  let orderItemsCreated = 0;

  for (const t of tasks) {
    if (!t.startDate) continue;

    const category = categorizeTask(t.taskName, t.assignedResource ?? null);
    const normalizedBuilding = normalizeLabel(t.building);
    const normalizedFloor = normalizeLabel(t.floor);
    const gcInstallDate = admin.firestore.Timestamp.fromDate(new Date(t.startDate));
    const gcInstallDateEnd = t.endDate
      ? admin.firestore.Timestamp.fromDate(new Date(t.endDate))
      : null;

    // Write task doc
    const taskRef = tasksRef.doc();
    const taskDoc: Omit<TaskDoc, "createdAt"> & { createdAt: FieldValue } = {
      projectId,
      scheduleUploadId: uploadId,
      taskIdOriginal: t.taskIdOriginal ?? null,
      taskName: t.taskName,
      building: normalizedBuilding,
      floor: normalizedFloor,
      gcInstallDate,
      gcInstallDateEnd,
      assignedResource: t.assignedResource ?? null,
      category,
      isOurTask: t.isOurTask,
      createdAt: now,
    };
    await taskRef.set(taskDoc);
    tasksCreated++;

    // Schedule change detection
    const diffKey = `${t.taskName}|${normalizedBuilding ?? ""}|${normalizedFloor ?? ""}`;
    const prevTask = prevTasksByKey.get(diffKey);
    if (prevTask && prevTask.gcInstallDate.toMillis() !== gcInstallDate.toMillis()) {
      const shiftDays = Math.round(
        (gcInstallDate.toMillis() - prevTask.gcInstallDate.toMillis()) / 86_400_000
      );
      const changeDoc: Omit<ScheduleChangeDoc, "detectedAt"> & {
        detectedAt: FieldValue;
      } = {
        projectId,
        taskId: taskRef.id,
        taskName: t.taskName,
        building: normalizedBuilding,
        floor: normalizedFloor,
        detectedAt: now,
        previousDate: prevTask.gcInstallDate,
        newDate: gcInstallDate,
        shiftDays,
        notificationsSent: false,
      };
      await changesRef.add(changeDoc);
    }

    // Order items only for our tasks
    if (!t.isOurTask) continue;

    if (category === "CABINET_DELIVERY") {
      const orderByDate = admin.firestore.Timestamp.fromMillis(
        gcInstallDate.toMillis() - LEAD_TIME_CABINETS_WEEKS * 7 * 86_400_000
      );
      const orderItemDoc: Omit<OrderItemDoc, "createdAt" | "updatedAt"> & {
        createdAt: FieldValue;
        updatedAt: FieldValue;
      } = {
        projectId,
        taskId: taskRef.id,
        itemType: "CABINETS_STANDARD",
        leadTimeWeeks: LEAD_TIME_CABINETS_WEEKS,
        orderByDate,
        orderedAt: null,
        poNumber: null,
        vendorName: null,
        notes: null,
        status: "NOT_ORDERED",
        taskName: t.taskName,
        building: normalizedBuilding,
        floor: normalizedFloor,
        gcInstallDate,
        createdAt: now,
        updatedAt: now,
      };
      await orderItemsRef.add(orderItemDoc);
      orderItemsCreated++;
    }

    if (category === "COUNTERTOP_SET") {
      const orderByDate = admin.firestore.Timestamp.fromMillis(
        gcInstallDate.toMillis() - LEAD_TIME_COUNTERTOPS_WEEKS * 7 * 86_400_000
      );
      const orderItemDoc: Omit<OrderItemDoc, "createdAt" | "updatedAt"> & {
        createdAt: FieldValue;
        updatedAt: FieldValue;
      } = {
        projectId,
        taskId: taskRef.id,
        itemType: "COUNTERTOPS",
        leadTimeWeeks: LEAD_TIME_COUNTERTOPS_WEEKS,
        orderByDate,
        orderedAt: null,
        poNumber: null,
        vendorName: null,
        notes: null,
        status: "NOT_ORDERED",
        taskName: t.taskName,
        building: normalizedBuilding,
        floor: normalizedFloor,
        gcInstallDate,
        createdAt: now,
        updatedAt: now,
      };
      await orderItemsRef.add(orderItemDoc);
      orderItemsCreated++;
    }
    // CABINET_INSTALL: no order item (chain generation deferred)
  }

  console.log(`[parser] Saved: ${tasksCreated} tasks, ${orderItemsCreated} order items`);
  return { tasksCreated, orderItemsCreated };
}

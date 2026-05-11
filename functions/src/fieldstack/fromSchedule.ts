/**
 * Create project from schedule — drop a PDF/XLSX/TXT and get a project + parsed tasks in one shot.
 * Claude extracts project name, GC, and all tasks from the document.
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import cors from "cors";
import { verifyCompanyMember, replyUnauthorized, replyBadRequest } from "./middleware";
import { COLLECTIONS, DEFAULT_LEAD_TIMES } from "./types";
import { createMessage } from "./anthropic";
import { extractTasksFromText, extractTasksFromPdfPage, saveParsedTasks } from "./schedules";
import { logger } from "../logger";

const db = admin.firestore();

const rawCorsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean)
  : [];

const corsHandler = cors({
  origin: (origin, callback) => {
    if (!origin || rawCorsOrigins.includes(origin)) { callback(null, true); return; }
    callback(new Error(`CORS: origin "${origin}" not allowed`));
  },
  methods: ["POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
});

interface ExtractedProjectInfo {
  projectName: string;
  address: string;
  gcName: string;
  gcContact?: string;
}

async function extractProjectInfo(
  input: string | { base64: string },
  companyId: string
): Promise<ExtractedProjectInfo> {
  const isPdf = typeof input !== "string";

  const userContent = isPdf
    ? [
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: (input as any).base64 },
        },
        { type: "text", text: "Extract the project info from this construction schedule. Return JSON only." },
      ]
    : [{ type: "text", text: `Extract the project info from this construction schedule. Return JSON only.\n\n${input}` }];

  const message = await createMessage({
    companyId,
    action: "extract_project_info",
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1024,
    system: `Extract project metadata from a construction schedule document. Return ONLY valid JSON with these fields:
{"projectName":"string","address":"string or empty","gcName":"general contractor company name","gcContact":"superintendent or contact name or empty"}
Use the document header, title block, or letterhead to find this info. If a field isn't present, use an empty string.`,
    messages: [{ role: "user", content: userContent as object[] }],
  });

  const text = message.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  const cleaned = text.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    return { projectName: "New Project", address: "", gcName: "Unknown GC" };
  }
}

function projectNameFromFilename(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || "New Project";
}

export const fromScheduleApi = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    let companyId: string;
    try {
      const auth = await verifyCompanyMember(req);
      companyId = auth.companyId;
    } catch {
      replyUnauthorized(res); return;
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      replyBadRequest(res, "ANTHROPIC_API_KEY not configured. Cannot parse schedule.");
      return;
    }

    // TODO: Parse multipart form data to extract file buffer
    // This requires busboy integration in Cloud Functions
    // For now, return a stub that explains what's needed
    logger.info("from-schedule called — multipart parsing pending", { companyId });

    res.json({
      message: "from-schedule endpoint requires multipart file parsing (busboy). See functions/src/fieldstack/fromSchedule.ts.",
    });
  });
});

/**
 * Internal helper: create project + parse schedule from a buffer.
 * Called by fromScheduleApi once multipart parsing is implemented.
 */
export async function createProjectFromSchedule(params: {
  companyId: string;
  fileName: string;
  buffer: Buffer;
  isPdf: boolean;
}): Promise<{
  projectId: string;
  tasksCreated: number;
  orderItemsCreated: number;
  chainsCreated: number;
}> {
  const { companyId, fileName, buffer, isPdf } = params;

  let rawText = "";
  let info: ExtractedProjectInfo;

  if (isPdf) {
    const base64 = buffer.toString("base64");
    info = await extractProjectInfo({ base64 }, companyId);
  } else if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
    // XLSX parsing would require a library — stub for now
    rawText = buffer.toString("utf-8");
    info = await extractProjectInfo(rawText, companyId);
  } else {
    rawText = buffer.toString("utf-8");
    info = await extractProjectInfo(rawText, companyId);
  }

  // Create project
  const projectRef = db.collection(COLLECTIONS.projects(companyId)).doc();
  const now = admin.firestore.FieldValue.serverTimestamp();

  await projectRef.set({
    id: projectRef.id,
    companyId,
    name: info.projectName || projectNameFromFilename(fileName),
    address: info.address || "",
    gcName: info.gcName || "Unknown GC",
    gcContact: info.gcContact || null,
    gcEmail: null,
    gcPlatform: null,
    gcProjectUrl: null,
    gcProjectId: null,
    procoreAccessToken: null,
    procoreRefreshToken: null,
    procoreTokenExpiry: null,
    procoreLastSync: null,
    autoSyncEnabled: false,
    status: "ACTIVE",
    alertCounts: { critical: 0, warning: 0 },
    createdAt: now,
    updatedAt: now,
  });

  // Seed lead times for this company if not already seeded
  const ltSnap = await db.collection(COLLECTIONS.leadTimeSettings(companyId)).limit(1).get();
  if (ltSnap.empty) {
    for (const lt of DEFAULT_LEAD_TIMES) {
      const ltRef = db.collection(COLLECTIONS.leadTimeSettings(companyId)).doc();
      await ltRef.set({
        id: ltRef.id,
        companyId,
        itemType: lt.itemType,
        label: lt.label,
        leadTimeWeeks: lt.leadTimeWeeks,
        isDefault: true,
        projectId: null,
        createdAt: now,
      });
    }
  }

  // Create upload record
  const uploadRef = db.collection(`${COLLECTIONS.projects(companyId)}/${projectRef.id}/scheduleUploads`).doc();
  await uploadRef.set({
    id: uploadRef.id,
    projectId: projectRef.id,
    companyId,
    fileName,
    rawText: isPdf ? "[PDF — parsed via vision]" : rawText,
    version: 1,
    uploadedAt: now,
    parsedAt: null,
  });

  // Parse tasks
  let tasks: any[] = [];
  if (isPdf) {
    // Get page count first, then extract page by page
    const base64 = buffer.toString("base64");
    const countMsg = await createMessage({
      companyId,
      action: "parse_schedule_page_count",
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 100,
      system: "Reply with ONLY the number of pages in this PDF.",
      messages: [{
        role: "user",
        content: [{
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: base64 },
          cache_control: { type: "ephemeral" },
        }, { type: "text", text: "How many pages?" }] as object[],
      }],
    });
    const pageCount = parseInt(countMsg.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim()) || 1;

    for (let i = 1; i <= pageCount; i++) {
      const pageTasks = await extractTasksFromPdfPage(base64, i, pageCount, companyId);
      tasks.push(...pageTasks);
    }
  } else if (rawText) {
    tasks = await extractTasksFromText(rawText, companyId);
  }

  const result = await saveParsedTasks(tasks, projectRef.id, companyId, uploadRef.id);

  return { projectId: projectRef.id, ...result };
}

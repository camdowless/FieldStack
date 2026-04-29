import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import cors from "cors";
import { FieldValue } from "firebase-admin/firestore";
import { getCompanyIdForUser } from "./companyHelpers";
import {
  xlsxBufferToText,
  parseScheduleWithVision,
  parseScheduleWithText,
  deduplicateTasks,
  saveParsedTasks,
} from "./parser";
import type { ScheduleUploadDoc, FeedEntryDoc, ProjectDoc } from "./types";

// ─── CORS / Auth (same pattern as projectFunctions.ts) ───────────────────────

const db = () => admin.firestore();

const rawCorsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean)
  : [];

const corsHandler = cors({
  origin: (origin, callback) => {
    if (!origin) { callback(null, true); return; }
    if (rawCorsOrigins.includes(origin)) callback(null, true);
    else callback(new Error(`CORS: origin "${origin}" is not allowed`));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
});

async function verifyUser(req: functions.https.Request): Promise<string> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new Error("UNAUTHENTICATED");
  const decoded = await admin.auth().verifyIdToken(header.split("Bearer ")[1]);
  return decoded.uid;
}

function handleError(res: functions.Response, err: unknown): void {
  const msg = err instanceof Error ? err.message : "Internal server error";
  if (msg === "UNAUTHENTICATED") { res.status(401).json({ error: "Unauthorized." }); return; }
  if (msg === "NO_COMPANY") { res.status(403).json({ error: "No company set up yet." }); return; }
  if (msg === "NOT_FOUND") { res.status(404).json({ error: "Not found." }); return; }
  if (msg === "FORBIDDEN") { res.status(403).json({ error: "Forbidden." }); return; }
  console.error("[fieldstack/schedule]", err);
  res.status(500).json({ error: msg });
}

// ─── uploadSchedule ───────────────────────────────────────────────────────────

export const uploadSchedule = functions
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
      if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

      // ── Auth ──────────────────────────────────────────────────────────────
      let uid: string;
      try { uid = await verifyUser(req); } catch (err) { handleError(res, err); return; }

      let companyId: string;
      try { companyId = await getCompanyIdForUser(uid); } catch (err) { handleError(res, err); return; }

      // ── Validate body ─────────────────────────────────────────────────────
      const { projectId, storagePath, fileName } = req.body ?? {};
      if (!projectId || typeof projectId !== "string") {
        res.status(400).json({ error: "projectId is required." }); return;
      }
      if (!storagePath || typeof storagePath !== "string") {
        res.status(400).json({ error: "storagePath is required." }); return;
      }
      if (!fileName || typeof fileName !== "string") {
        res.status(400).json({ error: "fileName is required." }); return;
      }

      // ── Verify project belongs to this company ────────────────────────────
      const projectSnap = await db().collection("projects").doc(projectId).get();
      if (!projectSnap.exists) { res.status(404).json({ error: "Project not found." }); return; }
      if ((projectSnap.data() as ProjectDoc).companyId !== companyId) {
        res.status(403).json({ error: "Forbidden." }); return;
      }

      // ── Compute version ───────────────────────────────────────────────────
      const lastUploadSnap = await db()
        .collection("projects").doc(projectId)
        .collection("scheduleUploads")
        .orderBy("version", "desc")
        .limit(1)
        .get();
      const version = lastUploadSnap.empty
        ? 1
        : (lastUploadSnap.docs[0].data().version as number) + 1;

      // ── Create upload doc immediately so frontend spinner shows ───────────
      const uploadRef = db()
        .collection("projects").doc(projectId)
        .collection("scheduleUploads").doc();
      const uploadId = uploadRef.id;

      const pendingDoc: Omit<ScheduleUploadDoc, "uploadedAt" | "parsedAt"> & {
        uploadedAt: FieldValue;
        parsedAt: null;
      } = {
        projectId,
        fileName,
        rawText: "",
        storagePath,
        version,
        uploadedAt: FieldValue.serverTimestamp(),
        parsedAt: null,
        status: "PARSING",
        parseResult: null,
        errorMessage: null,
      };
      await uploadRef.set(pendingDoc);

      // ── Download from Firebase Storage ────────────────────────────────────
      let fileBuffer: Buffer;
      try {
        const [fileBytes] = await admin.storage().bucket().file(storagePath).download();
        fileBuffer = Buffer.from(fileBytes);
      } catch (err) {
        await uploadRef.update({
          status: "FAILED",
          errorMessage: "Failed to download file from storage.",
          parsedAt: FieldValue.serverTimestamp(),
        });
        handleError(res, err);
        return;
      }

      // ── Parse by file type ────────────────────────────────────────────────
      const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
      let rawText = "";
      let rawTasks: ReturnType<typeof deduplicateTasks>;

      try {
        if (ext === "pdf") {
          rawTasks = deduplicateTasks(await parseScheduleWithVision(fileBuffer, companyId));
        } else {
          if (ext === "xlsx" || ext === "xls") {
            rawText = xlsxBufferToText(fileBuffer);
          } else {
            // csv / txt
            rawText = fileBuffer.toString("utf-8");
          }
          if (!rawText.trim()) {
            await uploadRef.update({
              status: "FAILED",
              errorMessage: "Could not extract text from file.",
              parsedAt: FieldValue.serverTimestamp(),
            });
            res.status(422).json({ error: "Could not extract text from file." });
            return;
          }
          // Persist extracted text so it's available for debugging / re-parsing
          await uploadRef.update({ rawText });
          rawTasks = deduplicateTasks(await parseScheduleWithText(rawText, companyId));
        }
      } catch (err) {
        await uploadRef.update({
          status: "FAILED",
          errorMessage: err instanceof Error ? err.message : "Parse failed.",
          parsedAt: FieldValue.serverTimestamp(),
        });
        handleError(res, err);
        return;
      }

      // ── Save tasks + order items to Firestore ─────────────────────────────
      let parseResult: { tasksCreated: number; orderItemsCreated: number };
      try {
        parseResult = await saveParsedTasks(rawTasks, projectId, uploadId);
      } catch (err) {
        await uploadRef.update({
          status: "FAILED",
          errorMessage: err instanceof Error ? err.message : "Failed to save tasks.",
          parsedAt: FieldValue.serverTimestamp(),
        });
        handleError(res, err);
        return;
      }

      // ── Count unnotified schedule changes for alertCount ──────────────────
      const changesSnap = await db()
        .collection("projects").doc(projectId)
        .collection("scheduleChanges")
        .where("notificationsSent", "==", false)
        .get();
      const alertCount = changesSnap.size;

      // ── Mark upload DONE ──────────────────────────────────────────────────
      await uploadRef.update({
        status: "DONE",
        parsedAt: FieldValue.serverTimestamp(),
        parseResult,
      });

      // ── Write feed entry (fire-and-forget) ────────────────────────────────
      const feedEntry: Omit<FeedEntryDoc, "createdAt"> & { createdAt: FieldValue } = {
        type: "schedule_parsed",
        title: `Schedule v${version} parsed`,
        summary: `${parseResult.tasksCreated} tasks extracted, ${parseResult.orderItemsCreated} order items created${alertCount > 0 ? `, ${alertCount} date change${alertCount === 1 ? "" : "s"} detected` : ""}.`,
        createdAt: FieldValue.serverTimestamp(),
        metadata: {
          uploadId,
          version,
          fileName,
          tasksCreated: parseResult.tasksCreated,
          orderItemsCreated: parseResult.orderItemsCreated,
          alertCount,
        },
      };
      db()
        .collection("projects").doc(projectId)
        .collection("feedEntries")
        .add(feedEntry)
        .catch((err) => console.error("[schedule] feed entry write failed:", err));

      // ── Return response matching frontend contract ─────────────────────────
      res.status(200).json({
        uploadId,
        version,
        tasksCreated: parseResult.tasksCreated,
        orderItemsCreated: parseResult.orderItemsCreated,
        alertCount,
      });
    });
  });

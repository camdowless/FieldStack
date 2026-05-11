import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import cors from "cors";
import { FieldValue } from "firebase-admin/firestore";
import { getCompanyIdForUser, provisionCompanyForUser } from "./companyHelpers";
import { computeAlertCountsForProject } from "./alerts";
import type { ProjectDoc, ProjectStatus, ProjectSummary, ScheduleUploadDoc, UploadStatus } from "./types";

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
  if (msg === "USER_NOT_FOUND") { res.status(404).json({ error: "User not found." }); return; }
  if (msg === "NOT_FOUND") { res.status(404).json({ error: "Not found." }); return; }
  if (msg === "FORBIDDEN") { res.status(403).json({ error: "Forbidden." }); return; }
  console.error("[fieldstack]", err);
  res.status(500).json({ error: msg });
}

// ─── provisionCompany ─────────────────────────────────────────────────────────

export const provisionCompany = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    let uid: string;
    try { uid = await verifyUser(req); } catch (err) { handleError(res, err); return; }

    const { companyName } = req.body ?? {};
    if (!companyName || typeof companyName !== "string" || companyName.trim().length < 2) {
      res.status(400).json({ error: "companyName must be at least 2 characters." });
      return;
    }

    try {
      const companyId = await provisionCompanyForUser(uid, companyName.trim());
      res.status(200).json({ companyId });
    } catch (err) { handleError(res, err); }
  });
});

// ─── createProject ────────────────────────────────────────────────────────────

export const createProject = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    let uid: string;
    try { uid = await verifyUser(req); } catch (err) { handleError(res, err); return; }

    let companyId: string;
    try { companyId = await getCompanyIdForUser(uid); } catch (err) { handleError(res, err); return; }

    const { name, address, gcName, gcContact, gcEmail } = req.body ?? {};
    if (!name || typeof name !== "string" || name.trim().length < 1) {
      res.status(400).json({ error: "name is required." });
      return;
    }
    if (!address || typeof address !== "string") {
      res.status(400).json({ error: "address is required." });
      return;
    }
    if (!gcName || typeof gcName !== "string") {
      res.status(400).json({ error: "gcName is required." });
      return;
    }

    try {
      const projectRef = db().collection("projects").doc();
      const now = FieldValue.serverTimestamp();
      const projectData: Omit<ProjectDoc, "createdAt" | "updatedAt"> & {
        createdAt: FieldValue;
        updatedAt: FieldValue;
      } = {
        companyId,
        name: name.trim().slice(0, 200),
        address: address.trim().slice(0, 300),
        gcName: gcName.trim().slice(0, 200),
        gcContact: (typeof gcContact === "string" ? gcContact.trim().slice(0, 200) : null) || null,
        gcEmail: (typeof gcEmail === "string" ? gcEmail.trim().slice(0, 200) : null) || null,
        status: "ACTIVE" as ProjectStatus,
        createdAt: now,
        updatedAt: now,
      };

      await projectRef.set(projectData);
      res.status(200).json({ id: projectRef.id });
    } catch (err) { handleError(res, err); }
  });
});

// ─── listProjects ─────────────────────────────────────────────────────────────

export const listProjects = functions
  .runWith({ timeoutSeconds: 60 })
  .https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

    let uid: string;
    try { uid = await verifyUser(req); } catch (err) { handleError(res, err); return; }

    let companyId: string;
    try { companyId = await getCompanyIdForUser(uid); } catch (err) { handleError(res, err); return; }

    try {
      const snap = await db()
        .collection("projects")
        .where("companyId", "==", companyId)
        .orderBy("createdAt", "desc")
        .get();

      const projects: ProjectSummary[] = await Promise.all(
        snap.docs.map(async (doc) => {
          const data = doc.data() as ProjectDoc;

          // Latest upload
          const uploadSnap = await db()
            .collection("projects")
            .doc(doc.id)
            .collection("scheduleUploads")
            .orderBy("version", "desc")
            .limit(1)
            .get();

          const latestUpload = uploadSnap.empty
            ? null
            : (() => {
                const u = uploadSnap.docs[0].data() as ScheduleUploadDoc;
                return {
                  version: u.version,
                  uploadedAt: u.uploadedAt.toMillis(),
                  status: u.status as UploadStatus,
                };
              })();

          // Alert counts
          const alertCounts = await computeAlertCountsForProject(doc.id);

          return {
            id: doc.id,
            companyId: data.companyId,
            name: data.name,
            address: data.address,
            gcName: data.gcName,
            gcContact: data.gcContact,
            gcEmail: data.gcEmail,
            status: data.status,
            createdAt: data.createdAt.toMillis(),
            updatedAt: data.updatedAt.toMillis(),
            alertCounts,
            latestUpload,
          };
        })
      );

      res.status(200).json({ projects });
    } catch (err) { handleError(res, err); }
  });
});

// ─── getProject ───────────────────────────────────────────────────────────────

export const getProject = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

    let uid: string;
    try { uid = await verifyUser(req); } catch (err) { handleError(res, err); return; }

    let companyId: string;
    try { companyId = await getCompanyIdForUser(uid); } catch (err) { handleError(res, err); return; }

    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : null;
    if (!projectId) { res.status(400).json({ error: "projectId is required." }); return; }

    try {
      const snap = await db().collection("projects").doc(projectId).get();
      if (!snap.exists) { res.status(404).json({ error: "Project not found." }); return; }

      const data = snap.data() as ProjectDoc;
      if (data.companyId !== companyId) { res.status(403).json({ error: "Forbidden." }); return; }

      const [alertCounts, uploadSnap] = await Promise.all([
        computeAlertCountsForProject(projectId),
        db().collection("projects").doc(projectId)
          .collection("scheduleUploads").orderBy("version", "desc").limit(1).get(),
      ]);

      const latestUpload = uploadSnap.empty
        ? null
        : (() => {
            const u = uploadSnap.docs[0].data() as ScheduleUploadDoc;
            return { version: u.version, uploadedAt: u.uploadedAt.toMillis(), status: u.status as UploadStatus };
          })();

      res.status(200).json({
        project: {
          id: snap.id,
          companyId: data.companyId,
          name: data.name,
          address: data.address,
          gcName: data.gcName,
          gcContact: data.gcContact,
          gcEmail: data.gcEmail,
          status: data.status,
          createdAt: data.createdAt.toMillis(),
          updatedAt: data.updatedAt.toMillis(),
          alertCounts,
          latestUpload,
        },
      });
    } catch (err) { handleError(res, err); }
  });
});

// ─── updateProject ────────────────────────────────────────────────────────────

export const updateProject = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    let uid: string;
    try { uid = await verifyUser(req); } catch (err) { handleError(res, err); return; }

    let companyId: string;
    try { companyId = await getCompanyIdForUser(uid); } catch (err) { handleError(res, err); return; }

    const { projectId, name, address, gcName, gcContact, gcEmail, status } = req.body ?? {};
    if (!projectId || typeof projectId !== "string") {
      res.status(400).json({ error: "projectId is required." });
      return;
    }

    const VALID_STATUSES: ProjectStatus[] = ["ACTIVE", "ON_HOLD", "COMPLETE"];
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      res.status(400).json({ error: "Invalid status." });
      return;
    }

    try {
      const snap = await db().collection("projects").doc(projectId).get();
      if (!snap.exists) { res.status(404).json({ error: "Project not found." }); return; }
      if ((snap.data() as ProjectDoc).companyId !== companyId) {
        res.status(403).json({ error: "Forbidden." });
        return;
      }

      const update: Record<string, unknown> = {
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (name !== undefined) update.name = String(name).trim().slice(0, 200);
      if (address !== undefined) update.address = String(address).trim().slice(0, 300);
      if (gcName !== undefined) update.gcName = String(gcName).trim().slice(0, 200);
      if (gcContact !== undefined) update.gcContact = String(gcContact).trim().slice(0, 200) || null;
      if (gcEmail !== undefined) update.gcEmail = String(gcEmail).trim().slice(0, 200) || null;
      if (status !== undefined) update.status = status;

      await db().collection("projects").doc(projectId).update(update);
      res.status(200).json({ success: true });
    } catch (err) { handleError(res, err); }
  });
});

// ─── deleteProject ────────────────────────────────────────────────────────────
// Soft-delete approach: sets status to a hidden value or just removes from list.
// For Phase 1 we do a hard delete of the project doc only.
// Sub-collection cleanup can be done async or via a separate task.

export const deleteProject = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    let uid: string;
    try { uid = await verifyUser(req); } catch (err) { handleError(res, err); return; }

    let companyId: string;
    try { companyId = await getCompanyIdForUser(uid); } catch (err) { handleError(res, err); return; }

    const { projectId } = req.body ?? {};
    if (!projectId || typeof projectId !== "string") {
      res.status(400).json({ error: "projectId is required." });
      return;
    }

    try {
      const snap = await db().collection("projects").doc(projectId).get();
      if (!snap.exists) { res.status(404).json({ error: "Project not found." }); return; }
      if ((snap.data() as ProjectDoc).companyId !== companyId) {
        res.status(403).json({ error: "Forbidden." });
        return;
      }

      await db().collection("projects").doc(projectId).delete();
      res.status(200).json({ success: true });
    } catch (err) { handleError(res, err); }
  });
});

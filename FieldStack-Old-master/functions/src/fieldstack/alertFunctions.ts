import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import cors from "cors";
import { getCompanyIdForUser } from "./companyHelpers";
import { computeProjectAlerts } from "./alerts";
import type { ProjectDoc } from "./types";

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
  console.error("[fieldstack/alerts]", err);
  res.status(500).json({ error: msg });
}

// ─── getProjectAlerts ─────────────────────────────────────────────────────────

export const getProjectAlerts = functions.https.onRequest((req, res) => {
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
      if ((snap.data() as ProjectDoc).companyId !== companyId) {
        res.status(403).json({ error: "Forbidden." });
        return;
      }

      const alerts = await computeProjectAlerts(projectId);
      res.status(200).json({ alerts });
    } catch (err) { handleError(res, err); }
  });
});

// ─── evaluateAlerts ───────────────────────────────────────────────────────────
// Manually triggered or called by a scheduled cron.
// Evaluates all ACTIVE projects for a company and returns a summary.
// Phase 2: wire to a Firebase Scheduled Function (pubsub.schedule).

export const evaluateAlerts = functions
  .runWith({ timeoutSeconds: 120 })
  .https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    let uid: string;
    try { uid = await verifyUser(req); } catch (err) { handleError(res, err); return; }

    let companyId: string;
    try { companyId = await getCompanyIdForUser(uid); } catch (err) { handleError(res, err); return; }

    try {
      const projectsSnap = await db()
        .collection("projects")
        .where("companyId", "==", companyId)
        .where("status", "==", "ACTIVE")
        .get();

      let totalCritical = 0;
      let totalWarning = 0;

      for (const projectDoc of projectsSnap.docs) {
        const alerts = await computeProjectAlerts(projectDoc.id);
        totalCritical += alerts.filter((a) => a.level === "CRITICAL").length;
        totalWarning += alerts.filter((a) => a.level === "WARNING").length;
      }

      res.status(200).json({
        evaluated: projectsSnap.size,
        totalCritical,
        totalWarning,
      });
    } catch (err) { handleError(res, err); }
  });
});

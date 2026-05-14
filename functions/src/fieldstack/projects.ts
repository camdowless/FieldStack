/**
 * Projects Cloud Functions — CRUD for company projects.
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import cors from "cors";
import { verifyCompanyMember, replyUnauthorized, replyBadRequest, replyNotFound } from "./middleware";
import { COLLECTIONS } from "./types";
import { sanitizeString, sanitizeUrl } from "../validation";
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
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
});

export const projectsApi = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    let companyId: string;
    try {
      const auth = await verifyCompanyMember(req);
      companyId = auth.companyId;
    } catch {
      replyUnauthorized(res); return;
    }

    const projectsCol = COLLECTIONS.projects(companyId);

    // GET /api/projects — list all projects
    if (req.method === "GET" && !req.path.match(/\/[^/]+$/)) {
      const snap = await db.collection(projectsCol).orderBy("createdAt", "desc").get();
      const projects = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      res.json(projects); return;
    }

    // POST /api/projects — create project
    if (req.method === "POST") {
      const { name, address, gcName, gcContact, gcEmail, gcPlatform } = req.body ?? {};
      if (!name || !address || !gcName) {
        replyBadRequest(res, "name, address, and gcName are required."); return;
      }

      const now = FieldValue.serverTimestamp();
      const ref = db.collection(projectsCol).doc();
      await ref.set({
        id: ref.id,
        companyId,
        name: sanitizeString(name),
        address: sanitizeString(address),
        gcName: sanitizeString(gcName),
        gcContact: gcContact ? sanitizeString(gcContact) : null,
        gcEmail: gcEmail ? sanitizeString(gcEmail) : null,
        gcPlatform: gcPlatform ?? null,
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

      logger.info("project created", { companyId, projectId: ref.id });
      res.json({ id: ref.id }); return;
    }

    // Extract project ID from path: /api/projects/{id}
    const pathMatch = req.path.match(/\/([^/]+)$/);
    const projectId = pathMatch?.[1];
    if (!projectId) { replyBadRequest(res, "Project ID required."); return; }

    const projectRef = db.doc(`${projectsCol}/${projectId}`);
    const projectSnap = await projectRef.get();
    if (!projectSnap.exists || projectSnap.data()?.companyId !== companyId) {
      replyNotFound(res, "Project not found."); return;
    }

    // PATCH /api/projects/{id} — update project
    if (req.method === "PATCH") {
      const allowed = ["name", "address", "gcName", "gcContact", "gcEmail", "gcPlatform", "status", "autoSyncEnabled"];
      const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
      for (const key of allowed) {
        if (req.body?.[key] !== undefined) {
          updates[key] = typeof req.body[key] === "string" ? sanitizeString(req.body[key]) : req.body[key];
        }
      }
      // gcProjectUrl gets URL-specific validation — invalid/empty values are cleared to null
      if (req.body?.gcProjectUrl !== undefined) {
        updates["gcProjectUrl"] = sanitizeUrl(req.body.gcProjectUrl);
      }
      await projectRef.update(updates);
      res.json({ success: true }); return;
    }

    // DELETE /api/projects/{id} — delete project and all subcollections
    if (req.method === "DELETE") {
      // Delete subcollections
      const subcollections = ["tasks", "orderItems", "scheduleChanges", "taskSteps", "feedEntries"];
      for (const sub of subcollections) {
        const subSnap = await projectRef.collection(sub).get();
        const batch = db.batch();
        subSnap.docs.forEach((d) => batch.delete(d.ref));
        if (subSnap.docs.length > 0) await batch.commit();
      }
      await projectRef.delete();
      logger.info("project deleted", { companyId, projectId });
      res.json({ success: true }); return;
    }

    res.status(405).json({ error: "Method not allowed" });
  });
});

/**
 * Team Cloud Functions — CRUD for company team members.
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import cors from "cors";
import { verifyCompanyMember, replyUnauthorized, replyBadRequest, replyNotFound } from "./middleware";
import { COLLECTIONS } from "./types";
import { sanitizeString } from "../validation";

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

const VALID_ROLES = ["OWNER", "SUPERVISOR", "PURCHASING", "INSTALLER", "DRAFTING"];

export const teamApi = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    let companyId: string;
    try {
      const auth = await verifyCompanyMember(req);
      companyId = auth.companyId;
    } catch {
      replyUnauthorized(res); return;
    }

    const teamCol = COLLECTIONS.teamMembers(companyId);

    // GET /api/team — list team members
    if (req.method === "GET" && !req.path.match(/\/[^/]+$/)) {
      const snap = await db.collection(teamCol).orderBy("createdAt", "asc").get();
      res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); return;
    }

    // POST /api/team — add team member
    if (req.method === "POST") {
      const { name, email, role, notifyOnCritical, notifyOnOrderReminder, notifyOnScheduleChange } = req.body ?? {};
      if (!name || !email || !role) {
        replyBadRequest(res, "name, email, and role are required."); return;
      }
      if (!VALID_ROLES.includes(role)) {
        replyBadRequest(res, `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}`); return;
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      const ref = db.collection(teamCol).doc();
      await ref.set({
        id: ref.id,
        companyId,
        name: sanitizeString(name),
        email: (sanitizeString(email) ?? "").toLowerCase(),
        role,
        notifyOnCritical: notifyOnCritical !== false,
        notifyOnOrderReminder: notifyOnOrderReminder !== false,
        notifyOnScheduleChange: notifyOnScheduleChange !== false,
        createdAt: now,
      });

      res.json({ id: ref.id }); return;
    }

    // Extract member ID from path
    const pathMatch = req.path.match(/\/([^/]+)$/);
    const memberId = pathMatch?.[1];
    if (!memberId) { replyBadRequest(res, "Member ID required."); return; }

    const memberRef = db.doc(`${teamCol}/${memberId}`);
    const memberSnap = await memberRef.get();
    if (!memberSnap.exists || memberSnap.data()?.companyId !== companyId) {
      replyNotFound(res, "Team member not found."); return;
    }

    // PATCH /api/team/{id}
    if (req.method === "PATCH") {
      const allowed = ["name", "role", "notifyOnCritical", "notifyOnOrderReminder", "notifyOnScheduleChange"];
      const updates: Record<string, unknown> = {};
      for (const key of allowed) {
        if (req.body?.[key] !== undefined) {
          updates[key] = typeof req.body[key] === "string" ? sanitizeString(req.body[key]) : req.body[key];
        }
      }
      if (updates.role && !VALID_ROLES.includes(updates.role as string)) {
        replyBadRequest(res, `Invalid role.`); return;
      }
      await memberRef.update(updates);
      res.json({ success: true }); return;
    }

    // DELETE /api/team/{id}
    if (req.method === "DELETE") {
      await memberRef.delete();
      res.json({ success: true }); return;
    }

    res.status(405).json({ error: "Method not allowed" });
  });
});

/**
 * Settings Cloud Functions — lead times, Gmail, SMS briefing (stubs).
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import cors from "cors";
import { verifyCompanyMember, replyUnauthorized, replyBadRequest } from "./middleware";
import { COLLECTIONS } from "./types";
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
  methods: ["GET", "PATCH", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
});

// ─── Lead Times ───────────────────────────────────────────────────────────────

export const leadTimesApi = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    let companyId: string;
    try {
      const auth = await verifyCompanyMember(req);
      companyId = auth.companyId;
    } catch {
      replyUnauthorized(res); return;
    }

    const col = COLLECTIONS.leadTimeSettings(companyId);

    if (req.method === "GET") {
      const snap = await db.collection(col).get();
      res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); return;
    }

    if (req.method === "PATCH") {
      const { settings } = req.body ?? {};
      if (!Array.isArray(settings)) { replyBadRequest(res, "settings array required."); return; }

      const batch = db.batch();
      for (const s of settings) {
        if (!s.itemType || typeof s.leadTimeWeeks !== "number") continue;
        // Find existing or create new
        const existing = await db.collection(col)
          .where("itemType", "==", s.itemType)
          .where("isDefault", "==", true)
          .limit(1)
          .get();

        if (!existing.empty) {
          batch.update(existing.docs[0].ref, { leadTimeWeeks: s.leadTimeWeeks });
        } else {
          const ref = db.collection(col).doc();
          batch.set(ref, {
            id: ref.id,
            companyId,
            itemType: s.itemType,
            leadTimeWeeks: s.leadTimeWeeks,
            isDefault: true,
            projectId: null,
            label: s.label ?? null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }
      await batch.commit();
      res.json({ success: true }); return;
    }

    res.status(405).json({ error: "Method not allowed" });
  });
});

// ─── Gmail ────────────────────────────────────────────────────────────────────

export const gmailApi = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    let companyId: string;
    try {
      const auth = await verifyCompanyMember(req);
      companyId = auth.companyId;
    } catch {
      replyUnauthorized(res); return;
    }

    // GET — connection status
    if (req.method === "GET") {
      const snap = await db.doc(`companies/${companyId}/gmailConnection`).get();
      if (!snap.exists) {
        res.json({ connected: false }); return;
      }
      const data = snap.data()!;
      res.json({ connected: true, email: data.email, lastSyncAt: data.lastSyncAt }); return;
    }

    // DELETE — disconnect Gmail
    if (req.method === "DELETE") {
      await db.doc(`companies/${companyId}/gmailConnection`).delete();
      res.json({ success: true }); return;
    }

    res.status(405).json({ error: "Method not allowed" });
  });
});

export const gmailCallbackApi = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    // TODO: Handle Gmail OAuth2 callback
    // 1. Exchange code for access + refresh tokens
    // 2. Store in companies/{companyId}/gmailConnection
    // 3. Redirect back to app

    logger.info("gmail/callback called (stub)");
    res.json({ message: "Gmail OAuth callback stub — implement OAuth2 flow." });
  });
});

export const gmailScanApi = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    let companyId: string;
    try {
      const auth = await verifyCompanyMember(req);
      companyId = auth.companyId;
    } catch {
      replyUnauthorized(res); return;
    }

    // TODO: Implement Gmail scanning
    // 1. Load Gmail connection tokens
    // 2. Refresh token if expired
    // 3. Fetch recent emails via Gmail API
    // 4. Classify each email with Claude
    // 5. Match to projects by name/address
    // 6. Save to feedEntries subcollection

    logger.info("gmail/scan called (stub)", { companyId });
    res.json({
      processed: 0,
      saved: 0,
      skipped: 0,
      message: "Gmail scan stub — connect Gmail and configure Google OAuth to enable.",
    });
  });
});

// ─── SMS Briefing ─────────────────────────────────────────────────────────────

export const smsBriefingApi = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    let companyId: string;
    try {
      const auth = await verifyCompanyMember(req);
      companyId = auth.companyId;
    } catch {
      replyUnauthorized(res); return;
    }

    const { phoneNumber } = req.body ?? {};
    if (!phoneNumber) { replyBadRequest(res, "phoneNumber is required."); return; }

    // TODO: Implement SMS briefing via Twilio
    // 1. Generate briefing text from Firestore data
    // 2. Send via Twilio SMS API

    const twilioConfigured = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
    logger.info("sms-briefing called (stub)", { companyId, twilioConfigured });

    res.json({
      sent: false,
      message: twilioConfigured
        ? "SMS briefing stub — implement Twilio sending in functions/src/fieldstack/settings.ts"
        : "Twilio not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER.",
    });
  });
});

// ─── My Tasks ─────────────────────────────────────────────────────────────────

export const myTasksApi = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

    let companyId: string;
    let uid: string;
    try {
      const auth = await verifyCompanyMember(req);
      companyId = auth.companyId;
      uid = auth.decoded.uid;
    } catch {
      replyUnauthorized(res); return;
    }

    // TODO: Find task steps assigned to this user across all projects
    // Use collection group query on taskSteps where assignedToId matches uid
    // (Need to store uid on TeamMember or match by email)

    logger.info("my-tasks called (stub)", { companyId, uid });
    res.json([]); // Stub: return empty array
  });
});

// ─── Procore ──────────────────────────────────────────────────────────────────

export const procoreAuthUrlApi = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

    let companyId: string;
    try {
      const auth = await verifyCompanyMember(req);
      companyId = auth.companyId;
    } catch {
      replyUnauthorized(res); return;
    }

    // TODO: Generate Procore OAuth URL
    const clientId = process.env.PROCORE_CLIENT_ID;
    if (!clientId) {
      res.json({ url: "#", message: "Procore OAuth not configured. Set PROCORE_CLIENT_ID." }); return;
    }

    const redirectUri = `${process.env.APP_URL}/api/procore/callback`;
    const url = `https://login.procore.com/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}`;
    res.json({ url });
  });
});

export const procoreSyncApi = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    let companyId: string;
    try {
      const auth = await verifyCompanyMember(req);
      companyId = auth.companyId;
    } catch {
      replyUnauthorized(res); return;
    }

    const { projectId } = req.body ?? {};
    if (!projectId) { replyBadRequest(res, "projectId is required."); return; }

    // TODO: Implement Procore sync
    // 1. Load project's Procore tokens
    // 2. Refresh if expired
    // 3. Fetch schedule tasks from Procore API
    // 4. Parse and save to Firestore (same as schedule upload)

    logger.info("procore/sync called (stub)", { companyId, projectId });
    res.json({
      tasksCreated: 0,
      tasksUpdated: 0,
      message: "Procore sync stub — configure Procore OAuth to enable.",
    });
  });
});

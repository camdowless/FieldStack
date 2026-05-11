/**
 * Alerts Cloud Functions — send alert emails (stub).
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
  methods: ["POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
});

export const alertsSendApi = functions.https.onRequest((req, res) => {
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

    // TODO: Implement actual alert email sending
    // Steps:
    // 1. Load all orderItems for the project
    // 2. Compute alert levels (CRITICAL/WARNING/INFO)
    // 3. Load team members with notification preferences
    // 4. Send emails via Resend to appropriate recipients
    // 5. Log escalation events

    const resendConfigured = !!process.env.RESEND_API_KEY;
    logger.info("alerts/send called (stub)", { companyId, projectId, resendConfigured });

    res.json({
      alerts: 0,
      changes: 0,
      resendConfigured,
      message: resendConfigured
        ? "Alert sending stub — implement email logic in functions/src/fieldstack/alerts.ts"
        : "Resend API key not configured. Set RESEND_API_KEY to enable email alerts.",
    });
  });
});

export const alertsSendToMemberApi = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    let companyId: string;
    try {
      const auth = await verifyCompanyMember(req);
      companyId = auth.companyId;
    } catch {
      replyUnauthorized(res); return;
    }

    const { email, alert, projectId } = req.body ?? {};
    if (!email || !alert) { replyBadRequest(res, "email and alert are required."); return; }

    // TODO: Send alert email to specific team member via Resend
    logger.info("alerts/send-to-member called (stub)", { companyId, projectId, email });

    res.json({ success: true, message: "Alert email stub — configure Resend to enable delivery." });
  });
});

// Cron: evaluate all alerts daily (called by Firebase Scheduler)
export const alertsEvaluateCron = functions.pubsub
  .schedule("0 7 * * *")
  .timeZone("UTC")
  .onRun(async (_context) => {
    logger.info("alertsEvaluateCron triggered");

    // TODO: Implement daily alert evaluation
    // 1. Load all active projects across all companies
    // 2. Compute alerts for each project
    // 3. Send digest emails to team members
    // 4. Update escalation levels

    logger.info("alertsEvaluateCron stub — implement in production");
  });

/**
 * Orders Cloud Function — PATCH order status, PO, vendor, notes.
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
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
  methods: ["PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
});

const VALID_STATUSES = ["NOT_ORDERED", "ORDERED", "IN_TRANSIT", "DELIVERED", "CANCELLED"];

export const ordersApi = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "PATCH") { res.status(405).json({ error: "Method not allowed" }); return; }

    let companyId: string;
    try {
      const auth = await verifyCompanyMember(req);
      companyId = auth.companyId;
    } catch {
      replyUnauthorized(res); return;
    }

    // Extract order ID from path: /api/orders/{id}
    const pathMatch = req.path.match(/\/([^/]+)$/);
    const orderId = pathMatch?.[1];
    if (!orderId) { replyBadRequest(res, "Order ID required."); return; }

    // Find the order across all projects for this company
    // We need to search subcollections — use a collection group query
    const orderSnap = await db
      .collectionGroup("orderItems")
      .where("id", "==", orderId)
      .where("companyId", "==", companyId)
      .limit(1)
      .get();

    if (orderSnap.empty) { replyNotFound(res, "Order not found."); return; }

    const orderRef = orderSnap.docs[0].ref;
    const { status, poNumber, vendorName, notes, orderedAt } = req.body ?? {};

    const updates: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        replyBadRequest(res, `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`); return;
      }
      updates.status = status;
      if (status === "ORDERED" && !orderedAt) {
        updates.orderedAt = FieldValue.serverTimestamp();
      }
    }
    if (poNumber !== undefined) updates.poNumber = sanitizeString(poNumber) || null;
    if (vendorName !== undefined) updates.vendorName = sanitizeString(vendorName) || null;
    if (notes !== undefined) updates.notes = sanitizeString(notes) || null;
    if (orderedAt !== undefined) updates.orderedAt = new Date(orderedAt);

    await orderRef.update(updates);
    res.json({ success: true });
  });
});

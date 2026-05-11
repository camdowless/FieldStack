import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import cors from "cors";
import { FieldValue } from "firebase-admin/firestore";
import { getCompanyIdForUser } from "./companyHelpers";
import type { OrderItemDoc, OrderStatus, ProjectDoc } from "./types";

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
  console.error("[fieldstack/orders]", err);
  res.status(500).json({ error: msg });
}

const VALID_ORDER_STATUSES: OrderStatus[] = [
  "NOT_ORDERED", "ORDERED", "IN_TRANSIT", "DELIVERED", "CANCELLED",
];

// ─── updateOrderItem ──────────────────────────────────────────────────────────

export const updateOrderItem = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    let uid: string;
    try { uid = await verifyUser(req); } catch (err) { handleError(res, err); return; }

    let companyId: string;
    try { companyId = await getCompanyIdForUser(uid); } catch (err) { handleError(res, err); return; }

    const { orderItemId, projectId, status, poNumber, vendorName, notes, orderedAt } = req.body ?? {};

    if (!orderItemId || typeof orderItemId !== "string") {
      res.status(400).json({ error: "orderItemId is required." });
      return;
    }
    if (!projectId || typeof projectId !== "string") {
      res.status(400).json({ error: "projectId is required." });
      return;
    }
    if (status !== undefined && !VALID_ORDER_STATUSES.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_ORDER_STATUSES.join(", ")}` });
      return;
    }

    try {
      // Verify project belongs to this company
      const projectSnap = await db().collection("projects").doc(projectId).get();
      if (!projectSnap.exists) { res.status(404).json({ error: "Project not found." }); return; }
      if ((projectSnap.data() as ProjectDoc).companyId !== companyId) {
        res.status(403).json({ error: "Forbidden." });
        return;
      }

      // Verify the order item exists under this project
      const itemRef = db()
        .collection("projects").doc(projectId)
        .collection("orderItems").doc(orderItemId);
      const itemSnap = await itemRef.get();
      if (!itemSnap.exists) { res.status(404).json({ error: "Order item not found." }); return; }

      const itemData = itemSnap.data() as OrderItemDoc;
      if (itemData.projectId !== projectId) {
        res.status(403).json({ error: "Forbidden." });
        return;
      }

      const update: Record<string, unknown> = {
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (status !== undefined) update.status = status;
      if (poNumber !== undefined) update.poNumber = typeof poNumber === "string" ? poNumber.trim().slice(0, 100) || null : null;
      if (vendorName !== undefined) update.vendorName = typeof vendorName === "string" ? vendorName.trim().slice(0, 200) || null : null;
      if (notes !== undefined) update.notes = typeof notes === "string" ? notes.trim().slice(0, 1000) || null : null;

      // Auto-set orderedAt when status moves to ORDERED (if not already set)
      if (status === "ORDERED" && !itemData.orderedAt) {
        update.orderedAt = FieldValue.serverTimestamp();
      } else if (orderedAt !== undefined) {
        update.orderedAt = orderedAt ? admin.firestore.Timestamp.fromMillis(Number(orderedAt)) : null;
      }

      await itemRef.update(update);
      res.status(200).json({ success: true });
    } catch (err) { handleError(res, err); }
  });
});

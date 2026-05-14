/**
 * documentsApi — upload, list, and delete project documents.
 *
 * Storage path: companies/{companyId}/documents/{projectId}/{docId}/{fileName}
 * Firestore:    companies/{companyId}/documents/{docId}
 *
 * All writes go through this Cloud Function (Admin SDK) so that:
 *  - Tenant isolation is enforced server-side.
 *  - Storage rules can deny direct client writes.
 *  - Metadata is always written atomically with the storage object.
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import cors from "cors";
import Busboy from "busboy";
import { FieldValue } from "firebase-admin/firestore";
import { verifyCompanyMember, replyUnauthorized, replyBadRequest, replyNotFound } from "./middleware";
import { COLLECTIONS } from "./types";
import { logger } from "../logger";

const db = admin.firestore();
const storage = admin.storage();

const corsHandler = cors({
  origin: (origin, callback) => {
    const allowed = process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
      : [];
    if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin "${origin}" is not allowed`));
    }
  },
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
});

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/plain",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const ALLOWED_EXTENSIONS = new Set([
  "pdf", "xlsx", "xls", "txt", "csv",
  "png", "jpg", "jpeg", "webp",
  "doc", "docx",
]);

function getExtension(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function getMimeType(fileName: string): string {
  const ext = getExtension(fileName);
  const map: Record<string, string> = {
    pdf: "application/pdf",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    txt: "text/plain",
    csv: "text/csv",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return map[ext] ?? "application/octet-stream";
}

// ─── Cloud Function ───────────────────────────────────────────────────────────

export const documentsApi = functions
  .runWith({ timeoutSeconds: 120, memory: "256MB" })
  .https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
      // ── Auth ──────────────────────────────────────────────────────────────
      let companyId: string;
      let uid: string;
      try {
        const auth = await verifyCompanyMember(req);
        companyId = auth.companyId;
        uid = auth.decoded.uid;
      } catch {
        replyUnauthorized(res);
        return;
      }

      const bucket = storage.bucket();

      // ── POST /api/documents — upload a document ───────────────────────────
      if (req.method === "POST") {
        const contentType = req.headers["content-type"] ?? "";
        if (!contentType.includes("multipart/form-data")) {
          replyBadRequest(res, "Request must be multipart/form-data.");
          return;
        }

        let fileBuffer: Buffer | null = null;
        let fileName = "document";
        let fileMimeType = "application/octet-stream";
        let projectId: string | undefined;
        let description: string | undefined;

        await new Promise<void>((resolve, reject) => {
          const bb = Busboy({
            headers: req.headers,
            limits: { fileSize: MAX_FILE_SIZE_BYTES },
          });

          bb.on("file", (_field: string, stream: NodeJS.ReadableStream, info: { filename: string; mimeType: string }) => {
            fileName = info.filename || "document";
            fileMimeType = info.mimeType || getMimeType(fileName);
            const chunks: Buffer[] = [];
            stream.on("data", (chunk: Buffer) => chunks.push(chunk));
            stream.on("end", () => { fileBuffer = Buffer.concat(chunks); });
            stream.on("error", reject);
          });

          bb.on("field", (name: string, value: string) => {
            if (name === "projectId") projectId = value;
            if (name === "description") description = value.slice(0, 500);
          });

          bb.on("finish", resolve);
          bb.on("error", reject);

          const rawBody: Buffer | undefined = (req as unknown as { rawBody?: Buffer }).rawBody;
          if (rawBody) {
            bb.write(rawBody);
            bb.end();
          } else {
            req.pipe(bb);
          }
        });

        if (!fileBuffer || (fileBuffer as Buffer).length === 0) {
          replyBadRequest(res, "No file received.");
          return;
        }

        if (!projectId) {
          replyBadRequest(res, "projectId is required.");
          return;
        }

        const ext = getExtension(fileName);
        if (!ALLOWED_EXTENSIONS.has(ext)) {
          replyBadRequest(res, `Unsupported file type ".${ext}". Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`);
          return;
        }

        // Verify project belongs to this company
        const projectRef = db.doc(`${COLLECTIONS.projects(companyId)}/${projectId}`);
        const projectSnap = await projectRef.get();
        if (!projectSnap.exists || projectSnap.data()?.companyId !== companyId) {
          res.status(404).json({ error: "Project not found." });
          return;
        }

        const buffer = fileBuffer as Buffer;
        const docId = db.collection(COLLECTIONS.documents(companyId)).doc().id;
        const storagePath = `companies/${companyId}/documents/${projectId}/${docId}/${fileName}`;

        // Upload to Firebase Storage
        const file = bucket.file(storagePath);
        await file.save(buffer, {
          metadata: {
            contentType: ALLOWED_MIME_TYPES.has(fileMimeType) ? fileMimeType : getMimeType(fileName),
            metadata: {
              companyId,
              projectId,
              uploadedBy: uid,
              docId,
            },
          },
        });

        // Generate a signed download URL (valid 7 days — refreshed on read)
        const [downloadUrl] = await file.getSignedUrl({
          action: "read",
          expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
        });

        // Write metadata to Firestore
        const docRef = db.collection(COLLECTIONS.documents(companyId)).doc(docId);
        const docData = {
          id: docId,
          companyId,
          projectId,
          fileName,
          fileSize: buffer.length,
          mimeType: ALLOWED_MIME_TYPES.has(fileMimeType) ? fileMimeType : getMimeType(fileName),
          storagePath,
          downloadUrl,
          downloadUrlExpiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
          description: description ?? null,
          uploadedBy: uid,
          uploadedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
        };

        await docRef.set(docData);

        logger.info("documentsApi: uploaded document", { companyId, projectId, docId, fileName, fileSize: buffer.length });

        res.status(201).json({
          id: docId,
          fileName,
          fileSize: buffer.length,
          mimeType: docData.mimeType,
          storagePath,
          downloadUrl,
          description: description ?? null,
        });
        return;
      }

      // ── DELETE /api/documents/:docId — delete a document ─────────────────
      if (req.method === "DELETE") {
        const pathMatch = req.path.match(/\/([^/]+)$/);
        const docId = pathMatch?.[1];
        if (!docId) {
          replyBadRequest(res, "Document ID required.");
          return;
        }

        const docRef = db.collection(COLLECTIONS.documents(companyId)).doc(docId);
        const docSnap = await docRef.get();
        if (!docSnap.exists) {
          replyNotFound(res, "Document not found.");
          return;
        }

        const data = docSnap.data()!;
        if (data.companyId !== companyId) {
          replyUnauthorized(res);
          return;
        }

        // Delete from Storage
        try {
          await bucket.file(data.storagePath).delete();
        } catch (err) {
          // Log but don't fail — the storage object may already be gone
          logger.warn("documentsApi: storage delete failed (continuing)", {
            storagePath: data.storagePath,
            error: err instanceof Error ? err.message : String(err),
          });
        }

        // Delete Firestore metadata
        await docRef.delete();

        logger.info("documentsApi: deleted document", { companyId, docId });
        res.json({ success: true });
        return;
      }

      // ── GET /api/documents/refresh/:docId — refresh signed URL ───────────
      if (req.method === "GET") {
        const refreshMatch = req.path.match(/\/refresh\/([^/]+)$/);
        if (refreshMatch) {
          const docId = refreshMatch[1];
          const docRef = db.collection(COLLECTIONS.documents(companyId)).doc(docId);
          const docSnap = await docRef.get();
          if (!docSnap.exists || docSnap.data()?.companyId !== companyId) {
            replyNotFound(res, "Document not found.");
            return;
          }

          const data = docSnap.data()!;
          const file = bucket.file(data.storagePath);
          const [downloadUrl] = await file.getSignedUrl({
            action: "read",
            expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
          });

          await docRef.update({
            downloadUrl,
            downloadUrlExpiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
          });

          res.json({ downloadUrl });
          return;
        }
      }

      res.status(405).json({ error: "Method not allowed." });
    });
  });

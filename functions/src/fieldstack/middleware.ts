/**
 * FieldStack middleware helpers.
 * Extends the base template's auth helpers with company-scoped verification.
 */

import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import { logger } from "../logger";
import { COLLECTIONS } from "./types";

const db = admin.firestore();

/**
 * Verify the request token and return the decoded token + companyId.
 * Looks up the user's company membership from the companyMembers collection.
 */
export async function verifyCompanyMember(
  req: functions.https.Request
): Promise<{ decoded: admin.auth.DecodedIdToken; companyId: string; role: string }> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new Error("UNAUTHENTICATED");

  const decoded = await admin.auth().verifyIdToken(header.split("Bearer ")[1]);
  const uid = decoded.uid;

  // Find the user's company membership
  const membershipsSnap = await db
    .collection(COLLECTIONS.companyMembers)
    .where("uid", "==", uid)
    .limit(1)
    .get();

  if (membershipsSnap.empty) {
    throw new Error("NO_COMPANY: User has no company membership");
  }

  const membership = membershipsSnap.docs[0].data();
  return {
    decoded,
    companyId: membership.companyId as string,
    role: membership.role as string,
  };
}

/**
 * Verify the request token and ensure the user is an ADMIN of their company.
 */
export async function verifyCompanyAdmin(
  req: functions.https.Request
): Promise<{ decoded: admin.auth.DecodedIdToken; companyId: string }> {
  const result = await verifyCompanyMember(req);
  if (result.role !== "ADMIN") {
    throw new Error("FORBIDDEN: Admin role required");
  }
  return result;
}

/**
 * Verify that a project belongs to the given company.
 */
export async function verifyProjectAccess(
  companyId: string,
  projectId: string
): Promise<admin.firestore.DocumentData> {
  const projectRef = db.doc(`${COLLECTIONS.projects(companyId)}/${projectId}`);
  const snap = await projectRef.get();
  if (!snap.exists) throw new Error("PROJECT_NOT_FOUND");
  const data = snap.data()!;
  if (data.companyId !== companyId) throw new Error("FORBIDDEN");
  return data;
}

export function replyUnauthorized(res: functions.Response): void {
  res.status(401).json({ error: "Unauthorized." });
}

export function replyForbidden(res: functions.Response): void {
  res.status(403).json({ error: "Forbidden." });
}

export function replyNotFound(res: functions.Response, msg = "Not found."): void {
  res.status(404).json({ error: msg });
}

export function replyBadRequest(res: functions.Response, msg: string): void {
  res.status(400).json({ error: msg });
}

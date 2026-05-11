import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

const db = () => admin.firestore();

/**
 * Returns the companyId for a Firebase UID.
 * Throws if the user doc is missing or has no companyId set yet.
 */
export async function getCompanyIdForUser(uid: string): Promise<string> {
  const snap = await db().collection("users").doc(uid).get();
  if (!snap.exists) throw new Error("USER_NOT_FOUND");
  const companyId = snap.data()?.companyId as string | undefined;
  if (!companyId) throw new Error("NO_COMPANY");
  return companyId;
}

/**
 * Called once from the CompanySetupScreen during onboarding.
 * Creates /companies/{newId} and writes companyId back to /users/{uid} atomically.
 * Idempotent: if companyId is already set on the user doc, returns the existing value.
 */
export async function provisionCompanyForUser(uid: string, companyName: string): Promise<string> {
  const userRef = db().collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new Error("USER_NOT_FOUND");

  const existing = userSnap.data()?.companyId as string | undefined;
  if (existing) return existing;

  const slug = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

  const companyRef = db().collection("companies").doc();
  const companyId = companyRef.id;

  const batch = db().batch();
  batch.set(companyRef, {
    name: companyName.trim().slice(0, 200),
    slug,
    ownerUid: uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.update(userRef, {
    companyId,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();
  return companyId;
}

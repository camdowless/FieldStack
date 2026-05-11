/**
 * ONE-TIME LOCAL BOOTSTRAP SCRIPT — never deploy as a Cloud Function.
 *
 * Sets the initial `{ role: "admin" }` Custom Claim on a given Firebase user UID.
 * Run this locally once to grant admin access to the first owner/developer.
 *
 * Usage:
 *   npx ts-node --project tsconfig.json scripts/bootstrap-admin.ts <uid>
 *   npx tsx scripts/bootstrap-admin.ts <uid>
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS env var pointing to a service account
 * JSON file, or run from an environment with Application Default Credentials.
 */

import * as admin from "firebase-admin";

const uid = process.argv[2];

if (!uid) {
  console.error("Error: uid argument is required.");
  console.error("Usage: npx tsx scripts/bootstrap-admin.ts <uid>");
  process.exit(1);
}

admin.initializeApp({ projectId: "search-edc58" });

async function run() {
  await admin.auth().setCustomUserClaims(uid, { role: "admin" });
  console.log(`Successfully set role: "admin" on uid: ${uid}`);
  process.exit(0);
}

run().catch((err) => {
  console.error("Failed to set admin claim:", err);
  process.exit(1);
});

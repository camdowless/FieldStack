/**
 * ONE-TIME LOCAL BACKFILL SCRIPT — never deploy as a Cloud Function.
 *
 * Iterates all Firebase Auth users and sets `{ role: "user" }` Custom Claim
 * on any account that has no `role` claim yet. Skips users that already have
 * a role (e.g. admins you've already bootstrapped).
 *
 * Usage:
 *   npx tsx scripts/backfill-user-roles.ts
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS env var pointing to a service account
 * JSON file, or run from an environment with Application Default Credentials.
 */

import * as admin from "firebase-admin";

admin.initializeApp({ projectId: "search-edc58" });

async function run() {
  let pageToken: string | undefined;
  let processed = 0;
  let skipped = 0;
  let updated = 0;

  do {
    const result = await admin.auth().listUsers(1000, pageToken);

    for (const user of result.users) {
      processed++;
      const role = (user.customClaims as Record<string, unknown> | undefined)?.role;

      if (role) {
        // Already has a role — leave it alone
        skipped++;
        continue;
      }

      await admin.auth().setCustomUserClaims(user.uid, { role: "user" });
      updated++;
      console.log(`  set role:user → ${user.uid} (${user.email ?? "no email"})`);
    }

    pageToken = result.pageToken;
  } while (pageToken);

  console.log(`\nDone. processed=${processed} updated=${updated} skipped=${skipped}`);
  process.exit(0);
}

run().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});

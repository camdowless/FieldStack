#!/usr/bin/env node
/**
 * scripts/migrateUsersToSoloPro.mjs
 *
 * One-time script: sets all existing users to the soloPro plan.
 * - Preserves creditsUsed (capped to soloPro limit of 30)
 * - Skips users already on soloPro, agency, or pro
 * - Processes in pages of 500 to avoid memory issues
 *
 * Usage:
 *   cd functions && npm run migrate:solopro
 *   cd functions && npm run migrate:solopro:emulator   # against local emulator
 */

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load functions/.env
const envPath = resolve(__dirname, "../.env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}

if (!getApps().length) {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath) {
    initializeApp({ credential: cert(JSON.parse(readFileSync(credPath, "utf8"))) });
  } else {
    initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "gimmeleads-10cdd" });
  }
}

const db = getFirestore();

const TARGET_PLAN = "soloPro";
const TARGET_CREDITS = 30;
// Plans that are already equal or higher — leave them alone
const SKIP_PLANS = new Set(["soloPro", "agency", "pro"]);

async function migrate() {
  let migrated = 0;
  let skipped = 0;
  let processed = 0;
  const PAGE_SIZE = 500;
  let lastDoc = null;
  let hasMore = true;

  console.log(`Migrating all users to "${TARGET_PLAN}" (${TARGET_CREDITS} credits/mo)…\n`);

  while (hasMore) {
    let q = db.collection("users").orderBy("__name__").limit(PAGE_SIZE);
    if (lastDoc) q = q.startAfter(lastDoc);

    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    let batchCount = 0;

    for (const doc of snap.docs) {
      processed++;
      const currentPlan = doc.data()?.subscription?.plan ?? "free";

      if (SKIP_PLANS.has(currentPlan)) {
        skipped++;
        continue;
      }

      const currentCreditsUsed = doc.data()?.subscription?.creditsUsed ?? 0;
      const cappedCreditsUsed = Math.min(currentCreditsUsed, TARGET_CREDITS);

      batch.update(doc.ref, {
        "subscription.plan": TARGET_PLAN,
        "subscription.creditsTotal": TARGET_CREDITS,
        "subscription.creditsUsed": cappedCreditsUsed,
        updatedAt: FieldValue.serverTimestamp(),
      });
      batchCount++;
      migrated++;
    }

    if (batchCount > 0) await batch.commit();

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < PAGE_SIZE) hasMore = false;

    console.log(`  processed ${processed} users so far…`);
  }

  console.log(`\n✅  Done. processed=${processed}  migrated=${migrated}  skipped=${skipped}`);
}

migrate().catch((err) => {
  console.error("❌  Migration failed:", err.message);
  process.exit(1);
});

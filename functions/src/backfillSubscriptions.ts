/**
 * One-time backfill script: migrates existing user documents from the flat
 * { plan, credits } shape to the new { subscription: { ... } } object.
 *
 * Usage:
 *   npx ts-node src/backfillSubscriptions.ts
 *
 * Safe to run multiple times — skips users that already have a subscription object.
 */

import * as admin from "firebase-admin";
import { PLAN_CREDITS, type SubscriptionPlan } from "./types";

// Initialize with explicit project ID.
// Auth: run `gcloud auth application-default login` first, or set
// GOOGLE_APPLICATION_CREDENTIALS to a service account key JSON file.
admin.initializeApp({ projectId: "gimmeleads-10cdd" });
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

const USERS_COLLECTION = "users";
const BATCH_SIZE = 500;

async function backfill() {
  console.log("Starting subscription backfill...\n");

  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let processed = 0;
  let migrated = 0;
  let skipped = 0;

  let hasMore = true;
  while (hasMore) {
    let query = db
      .collection(USERS_COLLECTION)
      .orderBy("__name__")
      .limit(BATCH_SIZE);

    if (lastDoc) query = query.startAfter(lastDoc);

    const snapshot = await query.get();
    if (snapshot.empty) {
      hasMore = false;
      break;
    }

    const batch = db.batch();
    let batchWrites = 0;

    for (const doc of snapshot.docs) {
      processed++;
      const data = doc.data();

      // Skip if already migrated
      if (data.subscription && typeof data.subscription === "object" && data.subscription.plan) {
        skipped++;
        continue;
      }

      // Read old flat fields
      const oldPlan = (data.plan as string) ?? "free";
      const oldCredits = (data.credits as number) ?? 0;

      // Map old plan to new plan type
      const plan: SubscriptionPlan = (oldPlan === "pro" ? "pro" : "free");
      const creditsTotal = PLAN_CREDITS[plan];

      // Convert old "remaining credits" to "credits used"
      // Old model: credits = remaining. New model: creditsUsed = total - remaining.
      const creditsUsed = Math.max(0, creditsTotal - oldCredits);

      const subscription = {
        plan,
        status: "active",
        creditsUsed,
        creditsTotal,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        cancelAtPeriodEnd: false,
      };

      batch.update(doc.ref, {
        subscription,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      batchWrites++;
      migrated++;

      console.log(
        `  [migrate] uid=${doc.id} email=${data.email ?? "?"} ` +
        `oldPlan=${oldPlan} oldCredits=${oldCredits} → ` +
        `plan=${plan} creditsUsed=${creditsUsed}/${creditsTotal}`
      );
    }

    if (batchWrites > 0) {
      await batch.commit();
      console.log(`  [batch] committed ${batchWrites} writes`);
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.docs.length < BATCH_SIZE) hasMore = false;
  }

  console.log(`\nBackfill complete: ${processed} users processed, ${migrated} migrated, ${skipped} already had subscription.`);
}

backfill().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});

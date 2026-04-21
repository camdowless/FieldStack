/**
 * Backfill script: reads all existing searches across all users and
 * rebuilds the admin/stats document from scratch.
 *
 * Run with:
 *   npx ts-node --project tsconfig.json scripts/backfillAdminStats.ts
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS or Firebase project default credentials.
 */

import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

async function run() {
  console.log("Starting admin stats backfill...");

  const usersSnap = await db.collection("users").get();
  console.log(`Found ${usersSnap.size} users`);

  let totalSearches = 0;
  let totalResultCount = 0;
  let totalDfsCost = 0;
  let totalBusinessSearch = 0;
  let totalInstantPages = 0;
  let totalLighthouse = 0;
  let totalCachedBusinesses = 0;
  let totalFreshBusinesses = 0;

  for (const userDoc of usersSnap.docs) {
    const searchesSnap = await db
      .collection("users")
      .doc(userDoc.id)
      .collection("searches")
      .get();

    for (const searchDoc of searchesSnap.docs) {
      const data = searchDoc.data();
      totalSearches++;
      totalResultCount += data.resultCount ?? 0;

      const cost = data.cost;
      if (cost) {
        totalDfsCost += cost.totalDfs ?? 0;
        totalBusinessSearch += cost.businessSearch ?? 0;
        totalInstantPages += cost.instantPages ?? 0;
        totalLighthouse += cost.lighthouse ?? 0;
        totalCachedBusinesses += cost.cachedBusinesses ?? 0;
        totalFreshBusinesses += cost.freshBusinesses ?? 0;
      }
    }

    console.log(`  uid=${userDoc.id}: ${searchesSnap.size} searches`);
  }

  const stats = {
    totalSearches,
    totalResultCount,
    totalDfsCost,
    totalBusinessSearch,
    totalInstantPages,
    totalLighthouse,
    totalCachedBusinesses,
    totalFreshBusinesses,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection("admin").doc("stats").set(stats);

  console.log("\nBackfill complete:");
  console.log(`  Total searches:   ${totalSearches}`);
  console.log(`  Total results:    ${totalResultCount}`);
  console.log(`  Total DFS cost:   $${totalDfsCost.toFixed(6)}`);
  console.log(`  Avg cost/search:  $${totalSearches > 0 ? (totalDfsCost / totalSearches).toFixed(6) : "0"}`);

  process.exit(0);
}

run().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});

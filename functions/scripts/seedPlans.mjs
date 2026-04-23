#!/usr/bin/env node
/**
 * scripts/seedPlans.mjs
 *
 * Seeds / updates the Firestore `plans` collection with Stripe Price IDs.
 * Edit the PLANS array below with your actual Stripe Price IDs, then run:
 *
 *   cd functions && node scripts/seedPlans.mjs
 *
 * Safe to re-run — uses set() with merge, so only the fields listed here
 * are written. Existing fields not mentioned are preserved.
 */

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
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

// ─── Edit these with your Stripe Price IDs ────────────────────────────────────

const PLANS = [
  {
    id: "free",
    name: "Free",
    priceUsdCents: 0,
    annualPriceUsdCents: null,
    stripePriceId: null,
    stripePriceIdAnnual: null,
    creditsPerMonth: 3,
    canSaveLeads: false,
    canGenerateScripts: false,
    features: ["3 searches / month", "Basic lead analysis"],
    sortOrder: 0,
    active: true,
  },
  {
    id: "soloPro",
    name: "SoloPro",
    priceUsdCents: 1900,
    annualPriceUsdCents: 15200,           // $152/yr (~$12.67/mo, save 33%)
    stripePriceId:"price_1TPRMtCJGegnNrTU7jFf8MYs",    // ← monthly Price ID from Stripe
    stripePriceIdAnnual: "price_1TPRXBCJGegnNrTUrogVAbr8", // ← annual Price ID from Stripe
    creditsPerMonth: 30,
    canSaveLeads: true,
    canGenerateScripts: false,
    features: ["30 searches / month", "Full lead analysis", "Save leads"],
    sortOrder: 1,
    active: true,
  },
  {
    id: "agency",
    name: "Agency",
    priceUsdCents: 4900,
    annualPriceUsdCents: 39200,           // $392/yr (~$32.67/mo, save 33%)
    stripePriceId: "price_1TPRNYCJGegnNrTUE2C21NOR",    // ← monthly Price ID from Stripe
    stripePriceIdAnnual: "price_1TPRXqCJGegnNrTUIwaQ9gZN", // ← annual Price ID from Stripe
    creditsPerMonth: 100,
    canSaveLeads: true,
    canGenerateScripts: true,
    features: ["100 searches / month", "Full lead analysis", "Save leads", "AI script generation"],
    sortOrder: 2,
    active: true,
  },
  {
    id: "pro",
    name: "Pro",
    priceUsdCents: 9900,
    annualPriceUsdCents: 79200,           // $792/yr (~$66/mo, save 33%)
    stripePriceId: "price_1TPRO6CJGegnNrTUEi6lruSV",    // ← monthly Price ID from Stripe
    stripePriceIdAnnual: "price_1TPRYOCJGegnNrTUz3wIRBJs", // ← annual Price ID from Stripe
    creditsPerMonth: 250,
    canSaveLeads: true,
    canGenerateScripts: true,
    features: ["250 searches / month", "Full lead analysis", "Save leads", "AI script generation", "Priority support"],
    sortOrder: 3,
    active: true,
  },
];

// ─────────────────────────────────────────────────────────────────────────────

async function seed() {
  // Warn if any price IDs are still placeholders
  const unset = PLANS.filter(
    (p) => p.stripePriceId === "price_REPLACE_ME" || p.stripePriceIdAnnual === "price_REPLACE_ME"
  );
  if (unset.length > 0) {
    console.warn(`⚠️  The following plans still have placeholder Price IDs:`);
    for (const p of unset) console.warn(`   - ${p.id}`);
    console.warn(`   Edit scripts/seedPlans.mjs and replace "price_REPLACE_ME" before running.\n`);
  }

  console.log(`Seeding ${PLANS.length} plans…\n`);

  for (const plan of PLANS) {
    const { id, ...data } = plan;
    const ref = db.collection("plans").doc(id);
    await ref.set(data, { merge: true });
    console.log(`  ✅  plans/${id} — ${data.name} (${data.priceUsdCents === 0 ? "free" : `$${data.priceUsdCents / 100}/mo`})`);
  }

  console.log(`\n✅  Done. ${PLANS.length} plans written to Firestore.`);
}

seed().catch((err) => {
  console.error("❌  Seed failed:", err.message);
  process.exit(1);
});

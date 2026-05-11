#!/usr/bin/env node
/**
 * scripts/seedPlans.mjs
 *
 * Seeds / updates the Firestore `plans` collection with plan configs and Stripe Price IDs.
 *
 * Usage:
 *   cd functions && node scripts/seedPlans.mjs                              # targets default project
 *   cd functions && GCLOUD_PROJECT=your-project-id node scripts/seedPlans.mjs
 *
 * Or use the npm scripts:
 *   bun run seed:plans          # dev
 *   bun run seed:plans:prod     # production
 *
 * Safe to re-run - uses set() with merge, so only the fields listed here
 * are written. Existing fields not mentioned are preserved.
 *
 * SETUP: Replace all "price_REPLACE_ME" values with your actual Stripe Price IDs.
 * Create prices in your Stripe dashboard first, then paste the IDs here.
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

const projectId = process.env.GCLOUD_PROJECT ?? "YOUR_PROJECT_ID";

if (!getApps().length) {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath) {
    const credFile = JSON.parse(readFileSync(credPath, "utf8"));
    if (credFile.type === "service_account") {
      initializeApp({ credential: cert(credFile), projectId });
    } else {
      initializeApp({ projectId });
    }
  } else {
    initializeApp({ projectId });
  }
}

const db = getFirestore();

// ─── Edit these plans to match your product ───────────────────────────────────
// Plan IDs must match the SubscriptionPlan type in functions/src/types.ts

const PLANS = [
  {
    id: "free",
    name: "Free",
    priceUsdCents: 0,
    annualPriceUsdCents: null,
    stripePriceId: null,
    stripePriceIdAnnual: null,
    creditsPerMonth: 5,
    canSaveLeads: false,
    canGenerateScripts: false,
    canEnrichContacts: false,
    features: [
      "5 credits / month",
      "Basic features",
    ],
    sortOrder: 0,
    active: true,
  },
  {
    id: "pro",
    name: "Pro",
    priceUsdCents: 1900,
    annualPriceUsdCents: 15200,           // $152/yr (~$12.67/mo, save 33%)
    stripePriceId: process.env.STRIPE_PRICE_PRO ?? "price_REPLACE_ME",
    stripePriceIdAnnual: process.env.STRIPE_PRICE_PRO_ANNUAL ?? "price_REPLACE_ME",
    creditsPerMonth: 50,
    canSaveLeads: true,
    canGenerateScripts: false,
    canEnrichContacts: false,
    features: [
      "50 credits / month",
      "All features",
      "Priority support",
    ],
    sortOrder: 1,
    active: true,
  },
  {
    id: "agency",
    name: "Agency",
    priceUsdCents: 4900,
    annualPriceUsdCents: 39200,           // $392/yr (~$32.67/mo, save 33%)
    stripePriceId: process.env.STRIPE_PRICE_AGENCY ?? "price_REPLACE_ME",
    stripePriceIdAnnual: process.env.STRIPE_PRICE_AGENCY_ANNUAL ?? "price_REPLACE_ME",
    creditsPerMonth: 200,
    canSaveLeads: true,
    canGenerateScripts: true,
    canEnrichContacts: true,
    features: [
      "200 credits / month",
      "All features",
      "Team access",
      "Priority support",
    ],
    sortOrder: 2,
    active: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    priceUsdCents: 9900,
    annualPriceUsdCents: 79200,           // $792/yr (~$66/mo, save 33%)
    stripePriceId: process.env.STRIPE_PRICE_ENTERPRISE ?? "price_REPLACE_ME",
    stripePriceIdAnnual: process.env.STRIPE_PRICE_ENTERPRISE_ANNUAL ?? "price_REPLACE_ME",
    creditsPerMonth: 1000,
    canSaveLeads: true,
    canGenerateScripts: true,
    canEnrichContacts: true,
    features: [
      "1,000 credits / month",
      "All features",
      "Unlimited team access",
      "Dedicated support",
    ],
    sortOrder: 3,
    active: true,
  },
];

// ─────────────────────────────────────────────────────────────────────────────

async function seed() {
  console.log(`Target project: ${projectId}\n`);

  const unset = PLANS.filter(
    (p) => p.stripePriceId === "price_REPLACE_ME" || p.stripePriceIdAnnual === "price_REPLACE_ME"
  );
  if (unset.length > 0) {
    console.warn(`Warning: The following plans still have placeholder Price IDs:`);
    for (const p of unset) console.warn(`  - ${p.id}`);
    console.warn(`  Edit scripts/seedPlans.mjs and replace "price_REPLACE_ME" before deploying.\n`);
  }

  console.log(`Seeding ${PLANS.length} plans...\n`);

  for (const plan of PLANS) {
    const { id, ...data } = plan;
    const ref = db.collection("plans").doc(id);
    await ref.set(data, { merge: true });
    console.log(`  plans/${id} - ${data.name} (${data.priceUsdCents === 0 ? "free" : `$${data.priceUsdCents / 100}/mo`})`);
  }

  console.log(`\nDone. ${PLANS.length} plans written to Firestore (project: ${projectId}).`);
}

seed().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});

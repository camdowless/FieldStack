/**
 * seedPlans.ts — Seed / update the Firestore `plans` collection.
 *
 * Run via the `seedPlans` Cloud Function (admin-only POST).
 * Safe to re-run — uses set() with merge so existing fields not in the
 * seed data are preserved.
 *
 * Stripe Price IDs are read from environment variables so they differ
 * between test and production without code changes.
 */

import type { PlanConfig } from "./plans";

export function buildPlanSeedData(): Omit<PlanConfig, "id">[] {
  return [
    {
      name: "Free",
      priceUsdCents: 0,
      annualPriceUsdCents: null,
      stripePriceId: null,
      stripePriceIdAnnual: null,
      creditsPerMonth: 3,
      canSaveLeads: false,
      canGenerateScripts: false,
      canEnrichContacts: false,
      features: [
        "3 searches / month",
        "Basic lead analysis",
      ],
      sortOrder: 0,
      active: true,
    },
    {
      name: "SoloPro",
      priceUsdCents: 1900,
      annualPriceUsdCents: 15200, // $152/yr = ~$12.67/mo (save 33%)
      stripePriceId: process.env.STRIPE_PRICE_SOLOPRO ?? null,
      stripePriceIdAnnual: process.env.STRIPE_PRICE_SOLOPRO_ANNUAL ?? null,
      creditsPerMonth: 30,
      canSaveLeads: true,
      canGenerateScripts: false,
      canEnrichContacts: false,
      features: [
        "30 searches / month",
        "Full lead analysis",
        "Save leads",
      ],
      sortOrder: 1,
      active: true,
    },
    {
      name: "Agency",
      priceUsdCents: 4900,
      annualPriceUsdCents: 39200, // $392/yr = ~$32.67/mo (save 33%)
      stripePriceId: process.env.STRIPE_PRICE_AGENCY ?? null,
      stripePriceIdAnnual: process.env.STRIPE_PRICE_AGENCY_ANNUAL ?? null,
      creditsPerMonth: 100,
      canSaveLeads: true,
      canGenerateScripts: true,
      canEnrichContacts: true,
      features: [
        "100 searches / month",
        "Full lead analysis",
        "Save leads",
        "AI script generation",
        "Website email & phone enrichment",
      ],
      sortOrder: 2,
      active: true,
    },
    {
      name: "Pro",
      priceUsdCents: 9900,
      annualPriceUsdCents: 79200, // $792/yr = ~$66/mo (save 33%)
      stripePriceId: process.env.STRIPE_PRICE_PRO ?? null,
      stripePriceIdAnnual: process.env.STRIPE_PRICE_PRO_ANNUAL ?? null,
      creditsPerMonth: 250,
      canSaveLeads: true,
      canGenerateScripts: true,
      canEnrichContacts: true,
      features: [
        "250 searches / month",
        "Full lead analysis",
        "Save leads",
        "AI script generation",
        "Website email & phone enrichment",
        "Priority support",
      ],
      sortOrder: 3,
      active: true,
    },
  ];
}

/** Plan IDs — must match Firestore document IDs */
export const PLAN_IDS = ["free", "soloPro", "agency", "pro"] as const;
export type PlanId = typeof PLAN_IDS[number];

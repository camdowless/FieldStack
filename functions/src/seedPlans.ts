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
      canSaveLeads: false,
      canGenerateScripts: false,
      canEnrichContacts: false,
      features: [
        "Basic features",
      ],
      sortOrder: 0,
      active: true,
    },
    {
      name: "Pro",
      priceUsdCents: 1900,
      annualPriceUsdCents: 15200,
      stripePriceId: process.env.STRIPE_PRICE_PRO ?? null,
      stripePriceIdAnnual: process.env.STRIPE_PRICE_PRO_ANNUAL ?? null,
      canSaveLeads: true,
      canGenerateScripts: false,
      canEnrichContacts: false,
      features: [
        "All features",
        "Priority support",
      ],
      sortOrder: 1,
      active: true,
    },
    {
      name: "Agency",
      priceUsdCents: 4900,
      annualPriceUsdCents: 39200,
      stripePriceId: process.env.STRIPE_PRICE_AGENCY ?? null,
      stripePriceIdAnnual: process.env.STRIPE_PRICE_AGENCY_ANNUAL ?? null,
      canSaveLeads: true,
      canGenerateScripts: true,
      canEnrichContacts: true,
      features: [
        "All features",
        "Team access",
        "Priority support",
      ],
      sortOrder: 2,
      active: true,
    },
    {
      name: "Enterprise",
      priceUsdCents: 9900,
      annualPriceUsdCents: 79200,
      stripePriceId: process.env.STRIPE_PRICE_ENTERPRISE ?? null,
      stripePriceIdAnnual: process.env.STRIPE_PRICE_ENTERPRISE_ANNUAL ?? null,
      canSaveLeads: true,
      canGenerateScripts: true,
      canEnrichContacts: true,
      features: [
        "All features",
        "Unlimited team access",
        "Dedicated support",
      ],
      sortOrder: 3,
      active: true,
    },
  ];
}

/** Plan IDs - must match Firestore document IDs and SubscriptionPlan type */
export const PLAN_IDS = ["free", "pro", "agency", "enterprise"] as const;
export type PlanId = typeof PLAN_IDS[number];

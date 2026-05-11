/**
 * seedPlans.ts — Seed / update the Firestore `plans` collection.
 *
 * Run via the `seedPlans` Cloud Function (admin-only POST).
 * Safe to re-run — uses set() with merge so existing fields not in the
 * seed data are preserved.
 *
 * Stripe Price IDs are read from environment variables so they differ
 * between test and production without code changes.
 *
 * TEMPLATE: Customize plan names, pricing, credits, feature flags,
 * and feature bullet points to match your product.
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
      creditsPerMonth: 10,
      featureFlags: {},
      features: [
        "10 actions / month",
        "Core features",
      ],
      sortOrder: 0,
      active: true,
    },
    {
      name: "Starter",
      priceUsdCents: 1900,
      annualPriceUsdCents: 15200,
      stripePriceId: process.env.STRIPE_PRICE_STARTER ?? null,
      stripePriceIdAnnual: process.env.STRIPE_PRICE_STARTER_ANNUAL ?? null,
      creditsPerMonth: 100,
      featureFlags: {
        featureA: true,
      },
      features: [
        "100 actions / month",
        "Core features",
        "Feature A",
      ],
      sortOrder: 1,
      active: true,
    },
    {
      name: "Growth",
      priceUsdCents: 4900,
      annualPriceUsdCents: 39200,
      stripePriceId: process.env.STRIPE_PRICE_GROWTH ?? null,
      stripePriceIdAnnual: process.env.STRIPE_PRICE_GROWTH_ANNUAL ?? null,
      creditsPerMonth: 500,
      featureFlags: {
        featureA: true,
        featureB: true,
      },
      features: [
        "500 actions / month",
        "Core features",
        "Feature A",
        "Feature B",
      ],
      sortOrder: 2,
      active: true,
    },
    {
      name: "Pro",
      priceUsdCents: 9900,
      annualPriceUsdCents: 79200,
      stripePriceId: process.env.STRIPE_PRICE_PRO ?? null,
      stripePriceIdAnnual: process.env.STRIPE_PRICE_PRO_ANNUAL ?? null,
      creditsPerMonth: 2000,
      featureFlags: {
        featureA: true,
        featureB: true,
        featureC: true,
      },
      features: [
        "2,000 actions / month",
        "Core features",
        "Feature A",
        "Feature B",
        "Feature C",
        "Priority support",
      ],
      sortOrder: 3,
      active: true,
    },
  ];
}

/** Plan IDs — must match Firestore document IDs */
export const PLAN_IDS = ["free", "starter", "growth", "pro"] as const;
export type PlanId = typeof PLAN_IDS[number];

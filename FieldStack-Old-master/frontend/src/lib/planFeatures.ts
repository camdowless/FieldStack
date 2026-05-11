/**
 * planFeatures.ts
 *
 * Plan feature utilities. All plan data comes from the Firestore `plans`
 * collection — nothing is hardcoded here.
 *
 * Use the `usePlans` hook to access plan configs in React components.
 * The pure helper functions below operate on a PlanConfig object so they
 * remain testable without a Firestore dependency.
 */

export type SubscriptionPlan = "free" | "soloPro" | "agency" | "pro";

export interface PlanConfig {
  id: string;
  name: string;
  /** Monthly price in USD cents */
  priceUsdCents: number;
  /** Annual price in USD cents (null if not offered) */
  annualPriceUsdCents: number | null;
  stripePriceId: string | null;
  stripePriceIdAnnual: string | null;
  creditsPerMonth: number;
  canSaveLeads: boolean;
  canGenerateScripts: boolean;
  features: string[];
  sortOrder: number;
  active: boolean;
}

export interface PlanFeatures {
  searches: number;
  canSaveLeads: boolean;
  canGenerateScripts: boolean;
}

/** Derive PlanFeatures from a PlanConfig object. */
export function getPlanFeatures(config: PlanConfig): PlanFeatures {
  return {
    searches: config.creditsPerMonth,
    canSaveLeads: config.canSaveLeads,
    canGenerateScripts: config.canGenerateScripts,
  };
}

export function canSaveLeads(config: PlanConfig): boolean {
  return config.canSaveLeads;
}

export function canGenerateScripts(config: PlanConfig): boolean {
  return config.canGenerateScripts;
}

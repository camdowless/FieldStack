/**
 * plans.ts — Firestore-backed plan configuration cache.
 *
 * The `plans` collection is the single source of truth for plan limits,
 * pricing, and feature flags. This module provides a cached accessor so
 * Cloud Functions don't hit Firestore on every request.
 *
 * Cache TTL: 5 minutes. Stale-while-revalidate pattern — the cached value
 * is returned immediately while a background refresh is triggered.
 */

import * as admin from "firebase-admin";

export interface PlanConfig {
  /** Internal plan identifier — matches SubscriptionPlan union type */
  id: string;
  /** Display name shown in UI */
  name: string;
  /** Monthly price in USD cents (0 for free) */
  priceUsdCents: number;
  /** Annual price in USD cents (0 or null if not offered) */
  annualPriceUsdCents: number | null;
  /** Stripe Price ID for monthly billing — null for free plan */
  stripePriceId: string | null;
  /** Stripe Price ID for annual billing — null if not offered */
  stripePriceIdAnnual: string | null;
  /** Monthly search credit limit */
  creditsPerMonth: number;
  /** Whether users on this plan can save leads */
  canSaveLeads: boolean;
  /** Whether users on this plan can generate scripts */
  canGenerateScripts: boolean;
  /** Whether users on this plan get website email/phone enrichment */
  canEnrichContacts: boolean;
  /** Feature bullet points for billing UI display */
  features: string[];
  /** Display sort order */
  sortOrder: number;
  /** Whether this plan is publicly available for purchase */
  active: boolean;
}

const PLANS_COLLECTION = "plans";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let _cache: Map<string, PlanConfig> | null = null;
let _cacheTimestamp = 0;
let _refreshPromise: Promise<void> | null = null;

function db(): FirebaseFirestore.Firestore {
  return admin.firestore();
}

async function fetchPlans(): Promise<Map<string, PlanConfig>> {
  const snap = await db().collection(PLANS_COLLECTION).get();
  const map = new Map<string, PlanConfig>();
  for (const doc of snap.docs) {
    map.set(doc.id, { id: doc.id, ...doc.data() } as PlanConfig);
  }
  return map;
}

async function refreshCache(): Promise<void> {
  try {
    _cache = await fetchPlans();
    _cacheTimestamp = Date.now();
  } finally {
    _refreshPromise = null;
  }
}

/**
 * Returns all plan configs, using the in-memory cache when fresh.
 * On first call (cold start) this always fetches from Firestore.
 */
export async function getAllPlans(): Promise<Map<string, PlanConfig>> {
  const now = Date.now();
  const stale = now - _cacheTimestamp > CACHE_TTL_MS;

  if (_cache && !stale) return _cache;

  if (_cache && stale) {
    // Stale-while-revalidate: return cached value, refresh in background
    if (!_refreshPromise) {
      _refreshPromise = refreshCache();
    }
    return _cache;
  }

  // Cold start — must wait for first fetch
  await refreshCache();
  return _cache!;
}

/**
 * Returns the PlanConfig for a given plan ID, or null if not found.
 */
export async function getPlanConfig(planId: string): Promise<PlanConfig | null> {
  const plans = await getAllPlans();
  return plans.get(planId) ?? null;
}

/**
 * Returns the credit limit for a given plan ID.
 * Falls back to 0 if the plan is not found (safe default — blocks searches).
 */
export async function getPlanCredits(planId: string): Promise<number> {
  const plan = await getPlanConfig(planId);
  if (!plan) {
    console.error(`[plans] getPlanCredits: unknown planId="${planId}" — returning 0`);
    return 0;
  }
  return plan.creditsPerMonth;
}

/**
 * Builds a Stripe Price ID → plan ID lookup map from the plans collection.
 * Used by the webhook handler to resolve plan from Stripe price.
 */
export async function buildPriceIdToPlanMap(): Promise<Map<string, string>> {
  const plans = await getAllPlans();
  const map = new Map<string, string>();
  for (const [planId, config] of plans) {
    if (config.stripePriceId) map.set(config.stripePriceId, planId);
    if (config.stripePriceIdAnnual) map.set(config.stripePriceIdAnnual, planId);
  }
  return map;
}

/** Invalidates the in-memory cache (call after seeding/updating plans). */
export function invalidatePlanCache(): void {
  _cache = null;
  _cacheTimestamp = 0;
}

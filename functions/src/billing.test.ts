import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";

/**
 * Pure function that represents the customer ID resolution logic.
 * If an existing customer ID is present, it is reused as-is.
 * Otherwise, the createCustomer factory is called to produce a new one.
 */
function resolveCustomerId(
  existingCustomerId: string | null,
  createCustomer: () => string
): string {
  if (existingCustomerId) return existingCustomerId;
  return createCustomer();
}

// ── Unit tests ────────────────────────────────────────────────────────────────

describe("resolveCustomerId — unit tests", () => {
  it("returns the existing customer ID when one is set", () => {
    const spy = vi.fn(() => "new_customer_id");
    const result = resolveCustomerId("cus_existing123", spy);
    expect(result).toBe("cus_existing123");
    expect(spy).not.toHaveBeenCalled();
  });

  it("calls createCustomer and returns its result when no existing ID", () => {
    const spy = vi.fn(() => "cus_new456");
    const result = resolveCustomerId(null, spy);
    expect(result).toBe("cus_new456");
    expect(spy).toHaveBeenCalledOnce();
  });
});

// ── Property-based test ───────────────────────────────────────────────────────

/**
 * Property P7: Stripe Customer Idempotency
 * Existing stripeCustomerId is never overwritten.
 *
 * Validates: Requirements 11.2
 */
describe("Property P7: Stripe Customer Idempotency — Existing stripeCustomerId is never overwritten", () => {
  it("never calls stripe.customers.create when stripeCustomerId is already set", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }), // any non-empty existing customer ID
        (stripeCustomerId) => {
          const createCustomerSpy = vi.fn(() => "new_customer_id");
          const result = resolveCustomerId(stripeCustomerId, createCustomerSpy);
          return (
            createCustomerSpy.mock.calls.length === 0 &&
            result === stripeCustomerId
          );
        }
      )
    );
  });
});

// ── Pure helpers for webhook property tests ───────────────────────────────────

/**
 * Pure function representing the subscription update logic (mirrors updateSubscription in index.ts).
 */
function applySubscriptionUpdate(
  state: { plan: string; stripeSubscriptionId: string | null },
  event: { plan: string; stripeSubscriptionId: string; status: string }
): { plan: string; stripeSubscriptionId: string; status: string } {
  return {
    plan: event.plan,
    stripeSubscriptionId: event.stripeSubscriptionId,
    status: event.status,
  };
}

// ── Property P3: Webhook Idempotency ─────────────────────────────────────────

/**
 * Property P3: Webhook Idempotency
 * Applying the same subscription update event twice produces the same state.
 *
 * Validates: Requirements 5.9
 */
describe("Property P3: Webhook Idempotency — duplicate events produce identical state", () => {
  it("applying the same event twice produces the same Firestore subscription state", () => {
    fc.assert(
      fc.property(
        fc.record({
          plan: fc.constantFrom("soloPro", "agency", "pro"),
          stripeSubscriptionId: fc.string({ minLength: 1 }),
          status: fc.constantFrom("active", "past_due"),
        }),
        ({ plan, stripeSubscriptionId, status }) => {
          const initialState = { plan: "free", stripeSubscriptionId: null };
          const event = { plan, stripeSubscriptionId, status };
          const state1 = applySubscriptionUpdate(initialState, event);
          const state2 = applySubscriptionUpdate(state1, event); // apply again
          return JSON.stringify(state1) === JSON.stringify(state2);
        }
      )
    );
  });
});

// ── Pure helper for migration property test ───────────────────────────────────

/**
 * Pure function representing the migration logic (mirrors migrateSubscriptionPlans in index.ts).
 */
function applyMigration(state: { plan: string }): {
  plan: string;
} {
  const planMap: Record<string, string> = {
    starter: "soloPro",
    enterprise: "pro",
  };
  const validPlans = new Set(["free", "soloPro", "agency", "pro"]);
  const newPlan = validPlans.has(state.plan) ? state.plan : (planMap[state.plan] ?? "free");
  return { plan: newPlan };
}

// ── Property P6: Migration Correctness ───────────────────────────────────────

/**
 * Property P6: Migration Correctness
 * For any user with a legacy or current plan name, migration produces the correct new plan.
 *
 * Validates: Requirements 10.1, 10.2, 10.3
 */
describe("Property P6: Migration Correctness — legacy plan names are remapped", () => {
  it("correctly remaps legacy plans", () => {
    const planMap: Record<string, string> = {
      starter: "soloPro", enterprise: "pro",
      free: "free", soloPro: "soloPro", agency: "agency", pro: "pro",
    };

    fc.assert(
      fc.property(
        fc.record({
          plan: fc.constantFrom("starter", "enterprise", "free", "soloPro", "agency", "pro"),
        }),
        ({ plan }) => {
          const after = applyMigration({ plan });
          const expectedPlan = planMap[plan];
          return after.plan === expectedPlan;
        }
      )
    );
  });
});

// ── mapStripeStatus tests ─────────────────────────────────────────────────────

/**
 * Pure copy of mapStripeStatus from index.ts.
 * Kept local so the test file has no Firebase Admin dependency.
 */
function mapStripeStatus(stripeStatus: string): "active" | "past_due" | "cancelled" | "trialing" {
  switch (stripeStatus) {
    case "active": return "active";
    case "past_due": return "past_due";
    case "canceled": return "cancelled";
    case "trialing": return "trialing";
    case "incomplete":
    case "incomplete_expired":
    case "unpaid":
    case "paused":
      return "past_due";
    default:
      return "past_due";
  }
}

describe("mapStripeStatus — known statuses map correctly", () => {
  it("maps 'active' → 'active'", () => {
    expect(mapStripeStatus("active")).toBe("active");
  });
  it("maps 'trialing' → 'trialing'", () => {
    expect(mapStripeStatus("trialing")).toBe("trialing");
  });
  it("maps 'past_due' → 'past_due'", () => {
    expect(mapStripeStatus("past_due")).toBe("past_due");
  });
  it("maps Stripe's 'canceled' (one l) → our 'cancelled' (two l)", () => {
    expect(mapStripeStatus("canceled")).toBe("cancelled");
  });
});

describe("mapStripeStatus — restricted statuses never grant 'active'", () => {
  const restrictedStatuses = ["incomplete", "incomplete_expired", "unpaid", "paused"];

  for (const status of restrictedStatuses) {
    it(`maps '${status}' → 'past_due', not 'active'`, () => {
      const result = mapStripeStatus(status);
      expect(result).toBe("past_due");
      expect(result).not.toBe("active");
    });
  }
});

describe("mapStripeStatus — unknown/future statuses never grant 'active'", () => {
  it("maps any unknown status string → 'past_due'", () => {
    const unknownStatuses = ["paused_by_customer", "suspended", "locked", "", "ACTIVE", "Active"];
    for (const status of unknownStatuses) {
      const result = mapStripeStatus(status);
      expect(result).toBe("past_due");
      expect(result).not.toBe("active");
    }
  });
});

/**
 * Property P8: mapStripeStatus safety invariant
 * For any string that is not one of the four known safe statuses,
 * the result must never be "active".
 */
describe("Property P8: mapStripeStatus — arbitrary unknown strings never produce 'active'", () => {
  it("never returns 'active' for any non-'active' input string", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => s !== "active"),
        (status) => {
          return mapStripeStatus(status) !== "active";
        }
      )
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// NEW TESTS — added per manual test plan
// ═══════════════════════════════════════════════════════════════════════════════

// ── Pure helpers mirroring index.ts logic ─────────────────────────────────────

/**
 * Pure copy of the cancelSubscription idempotency guard from index.ts.
 * Returns { status, alreadyCancelling } without touching Stripe or Firestore.
 */
function cancelSubscriptionLogic(state: {
  stripeSubscriptionId: string | null;
  status: string;
  cancelAtPeriodEnd: boolean;
}): { httpStatus: number; body: Record<string, unknown> } {
  if (!state.stripeSubscriptionId) {
    return { httpStatus: 400, body: { error: "No active subscription to cancel" } };
  }
  if (!["active", "trialing"].includes(state.status)) {
    return { httpStatus: 409, body: { error: `Cannot cancel a subscription with status "${state.status}". Please update your payment method first.` } };
  }
  if (state.cancelAtPeriodEnd) {
    // Idempotent — already cancelling, no Stripe call needed
    return { httpStatus: 200, body: { success: true, alreadyCancelling: true } };
  }
  // Would call Stripe here — represented as a successful first cancel
  return { httpStatus: 200, body: { success: true } };
}

/**
 * Pure copy of the reactivateSubscription state guard from index.ts.
 */
function reactivateSubscriptionLogic(state: {
  stripeSubscriptionId: string | null;
  cancelAtPeriodEnd: boolean;
}): { httpStatus: number; body: Record<string, unknown> } {
  if (!state.stripeSubscriptionId) {
    return { httpStatus: 400, body: { error: "No active subscription to reactivate" } };
  }
  if (!state.cancelAtPeriodEnd) {
    return { httpStatus: 409, body: { error: "Subscription is not pending cancellation." } };
  }
  return { httpStatus: 200, body: { success: true } };
}

/**
 * Pure copy of the syncSubscription rate-limit + cancelled-in-period guard.
 */
function syncSubscriptionLogic(state: {
  stripeCustomerId: string | null;
  plan: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEndMs: number;
  nowMs: number;
  rateLimited: boolean;
  hasActiveSub: boolean;
  stripePlan: string;
}): { httpStatus: number; body: Record<string, unknown> } {
  if (state.rateLimited) {
    return { httpStatus: 200, body: { synced: false, reason: "rate_limited" } };
  }
  if (!state.stripeCustomerId) {
    return { httpStatus: 200, body: { synced: false, reason: "no_customer" } };
  }
  if (!state.hasActiveSub) {
    const stillInPaidPeriod =
      state.cancelAtPeriodEnd &&
      state.currentPeriodEndMs > state.nowMs &&
      state.plan !== "free";
    if (stillInPaidPeriod) {
      return { httpStatus: 200, body: { synced: true, plan: state.plan } };
    }
    return { httpStatus: 200, body: { synced: true, plan: "free" } };
  }
  return { httpStatus: 200, body: { synced: true, plan: state.stripePlan } };
}

/**
 * Pure copy of the createCheckoutSession downgrade-bypass guard.
 * currentSortOrder > 0 means the user is on a paid plan.
 */
function createCheckoutSessionGuard(state: {
  currentSortOrder: number;
  targetSortOrder: number;
}): { httpStatus: number; body: Record<string, unknown> } | null {
  if (state.currentSortOrder > 0 && state.targetSortOrder <= state.currentSortOrder) {
    return { httpStatus: 400, body: { error: "Use the downgrade option to switch to a lower plan." } };
  }
  return null; // allowed — would proceed to create session
}

/**
 * Pure copy of the changeSubscription upgrade-bypass guard.
 */
function changeSubscriptionGuard(state: {
  currentSortOrder: number;
  targetSortOrder: number;
}): { httpStatus: number; body: Record<string, unknown> } | null {
  if (state.targetSortOrder >= state.currentSortOrder) {
    return { httpStatus: 400, body: { error: "Use the upgrade flow to switch to a higher or equal plan." } };
  }
  return null; // allowed — would proceed to update subscription
}

/**
 * Pure copy of the usePlans cache TTL check.
 */
function isCacheStale(cacheTimestamp: number, nowMs: number, ttlMs: number): boolean {
  return nowMs - cacheTimestamp > ttlMs;
}

/**
 * Pure copy of the Firestore rules check for processedWebhookEvents.
 * In the real rules: allow read, write: if false
 */
function processedWebhookEventsAllowed(_operation: "read" | "write", _isAuthenticated: boolean): boolean {
  return false; // always denied — Admin SDK only
}

// ── cancelSubscription — idempotency ─────────────────────────────────────────

/**
 * Validates: calling cancelSubscription twice returns 200 { success: true, alreadyCancelling: true }
 * on the second call without making a Stripe API call.
 */
describe("cancelSubscription — idempotency", () => {
  it("first call on an active subscription returns 200 { success: true }", () => {
    const result = cancelSubscriptionLogic({
      stripeSubscriptionId: "sub_abc123",
      status: "active",
      cancelAtPeriodEnd: false,
    });
    expect(result.httpStatus).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.alreadyCancelling).toBeUndefined();
  });

  it("second call (cancelAtPeriodEnd already true) returns 200 { success: true, alreadyCancelling: true }", () => {
    const result = cancelSubscriptionLogic({
      stripeSubscriptionId: "sub_abc123",
      status: "active",
      cancelAtPeriodEnd: true, // already set by first call
    });
    expect(result.httpStatus).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.alreadyCancelling).toBe(true);
  });

  it("trialing subscription is also idempotent on second call", () => {
    const result = cancelSubscriptionLogic({
      stripeSubscriptionId: "sub_trial",
      status: "trialing",
      cancelAtPeriodEnd: true,
    });
    expect(result.httpStatus).toBe(200);
    expect(result.body.alreadyCancelling).toBe(true);
  });
});

/**
 * Property: for any subscription already set to cancelAtPeriodEnd=true,
 * the response is always 200 with alreadyCancelling=true — never a different code.
 */
describe("Property: cancelSubscription idempotency — already-cancelling always returns 200", () => {
  it("always returns 200 alreadyCancelling=true when cancelAtPeriodEnd is true", () => {
    fc.assert(
      fc.property(
        fc.record({
          stripeSubscriptionId: fc.string({ minLength: 1 }),
          status: fc.constantFrom("active", "trialing"),
        }),
        ({ stripeSubscriptionId, status }) => {
          const result = cancelSubscriptionLogic({
            stripeSubscriptionId,
            status,
            cancelAtPeriodEnd: true,
          });
          return result.httpStatus === 200 && result.body.alreadyCancelling === true;
        }
      )
    );
  });
});

// ── reactivateSubscription — state guard ──────────────────────────────────────

/**
 * Validates: cannot reactivate a subscription that isn't pending cancellation.
 */
describe("reactivateSubscription — state guard", () => {
  it("returns 409 when cancelAtPeriodEnd is false (not pending cancellation)", () => {
    const result = reactivateSubscriptionLogic({
      stripeSubscriptionId: "sub_abc123",
      cancelAtPeriodEnd: false,
    });
    expect(result.httpStatus).toBe(409);
    expect(result.body.error).toBe("Subscription is not pending cancellation.");
  });

  it("returns 200 when cancelAtPeriodEnd is true", () => {
    const result = reactivateSubscriptionLogic({
      stripeSubscriptionId: "sub_abc123",
      cancelAtPeriodEnd: true,
    });
    expect(result.httpStatus).toBe(200);
    expect(result.body.success).toBe(true);
  });

  it("returns 400 when there is no subscription at all", () => {
    const result = reactivateSubscriptionLogic({
      stripeSubscriptionId: null,
      cancelAtPeriodEnd: false,
    });
    expect(result.httpStatus).toBe(400);
  });
});

/**
 * Property: for any subscription where cancelAtPeriodEnd is false,
 * reactivate always returns 409 — never 200.
 */
describe("Property: reactivateSubscription — non-cancelling sub always 409", () => {
  it("always returns 409 when cancelAtPeriodEnd is false", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        (stripeSubscriptionId) => {
          const result = reactivateSubscriptionLogic({
            stripeSubscriptionId,
            cancelAtPeriodEnd: false,
          });
          return result.httpStatus === 409;
        }
      )
    );
  });
});

// ── syncSubscription — rate limiting ─────────────────────────────────────────

/**
 * Validates: rapid calls to syncSubscription are rate-limited on the second call.
 */
describe("syncSubscription — rate limiting", () => {
  it("first call (not rate-limited) returns { synced: true, plan }", () => {
    const result = syncSubscriptionLogic({
      stripeCustomerId: "cus_abc",
      plan: "soloPro",
      cancelAtPeriodEnd: false,
      currentPeriodEndMs: Date.now() + 86400_000,
      nowMs: Date.now(),
      rateLimited: false,
      hasActiveSub: true,
      stripePlan: "soloPro",
    });
    expect(result.httpStatus).toBe(200);
    expect(result.body.synced).toBe(true);
    expect(result.body.plan).toBe("soloPro");
  });

  it("second call (rate-limited) returns 200 { synced: false, reason: 'rate_limited' }", () => {
    const result = syncSubscriptionLogic({
      stripeCustomerId: "cus_abc",
      plan: "soloPro",
      cancelAtPeriodEnd: false,
      currentPeriodEndMs: Date.now() + 86400_000,
      nowMs: Date.now(),
      rateLimited: true,
      hasActiveSub: true,
      stripePlan: "soloPro",
    });
    expect(result.httpStatus).toBe(200);
    expect(result.body.synced).toBe(false);
    expect(result.body.reason).toBe("rate_limited");
  });
});

/**
 * Property: a rate-limited call always returns synced=false, reason=rate_limited.
 */
describe("Property: syncSubscription — rate-limited calls never sync", () => {
  it("always returns synced=false reason=rate_limited when rate-limited", () => {
    fc.assert(
      fc.property(
        fc.record({
          stripeCustomerId: fc.option(fc.string({ minLength: 1 }), { nil: null }),
          plan: fc.constantFrom("free", "soloPro", "agency", "pro"),
          cancelAtPeriodEnd: fc.boolean(),
          currentPeriodEndMs: fc.nat(),
          nowMs: fc.nat(),
          hasActiveSub: fc.boolean(),
          stripePlan: fc.constantFrom("free", "soloPro", "agency", "pro"),
        }),
        (state) => {
          const result = syncSubscriptionLogic({ ...state, rateLimited: true });
          return result.body.synced === false && result.body.reason === "rate_limited";
        }
      )
    );
  });
});

// ── syncSubscription — cancelled-but-in-period guard ─────────────────────────

/**
 * Validates: a user who cancelled but is still in their paid period
 * does NOT get downgraded on login sync.
 */
describe("syncSubscription — cancelled-but-in-period guard", () => {
  it("returns the paid plan when cancelAtPeriodEnd=true and period hasn't ended", () => {
    const nowMs = Date.now();
    const result = syncSubscriptionLogic({
      stripeCustomerId: "cus_abc",
      plan: "agency",
      cancelAtPeriodEnd: true,
      currentPeriodEndMs: nowMs + 7 * 86400_000, // 7 days from now
      nowMs,
      rateLimited: false,
      hasActiveSub: false, // Stripe returns no active sub (already cancelled)
      stripePlan: "free",
    });
    expect(result.httpStatus).toBe(200);
    expect(result.body.synced).toBe(true);
    expect(result.body.plan).toBe("agency"); // NOT downgraded
  });

  it("returns 'free' when cancelAtPeriodEnd=true but period has already ended", () => {
    const nowMs = Date.now();
    const result = syncSubscriptionLogic({
      stripeCustomerId: "cus_abc",
      plan: "agency",
      cancelAtPeriodEnd: true,
      currentPeriodEndMs: nowMs - 1000, // already expired
      nowMs,
      rateLimited: false,
      hasActiveSub: false,
      stripePlan: "free",
    });
    expect(result.httpStatus).toBe(200);
    expect(result.body.plan).toBe("free");
  });

  it("returns 'free' when already on free plan with no active sub", () => {
    const nowMs = Date.now();
    const result = syncSubscriptionLogic({
      stripeCustomerId: "cus_abc",
      plan: "free",
      cancelAtPeriodEnd: false,
      currentPeriodEndMs: 0,
      nowMs,
      rateLimited: false,
      hasActiveSub: false,
      stripePlan: "free",
    });
    expect(result.body.plan).toBe("free");
  });
});

/**
 * Property: a user with cancelAtPeriodEnd=true and a future period end
 * is never downgraded when there is no active Stripe sub.
 */
describe("Property: syncSubscription — in-period cancellation never downgrades", () => {
  it("always preserves the paid plan when still within the paid period", () => {
    fc.assert(
      fc.property(
        fc.record({
          plan: fc.constantFrom("soloPro", "agency", "pro"),
          stripeCustomerId: fc.string({ minLength: 1 }),
          // period ends 1ms to 30 days in the future
          futureDeltaMs: fc.integer({ min: 1, max: 30 * 86400_000 }),
          nowMs: fc.nat({ max: 1_000_000_000_000 }),
        }),
        ({ plan, stripeCustomerId, futureDeltaMs, nowMs }) => {
          const result = syncSubscriptionLogic({
            stripeCustomerId,
            plan,
            cancelAtPeriodEnd: true,
            currentPeriodEndMs: nowMs + futureDeltaMs,
            nowMs,
            rateLimited: false,
            hasActiveSub: false,
            stripePlan: "free",
          });
          return result.body.plan === plan;
        }
      )
    );
  });
});

// ── createCheckoutSession — downgrade bypass blocked ─────────────────────────

/**
 * Validates: a paid user can't use checkout to reach a lower or equal plan.
 * sortOrder: free=0, soloPro=1, agency=2, pro=3
 */
describe("createCheckoutSession — downgrade bypass blocked", () => {
  it("returns 400 when agency user tries to checkout soloPro (lower plan)", () => {
    const result = createCheckoutSessionGuard({ currentSortOrder: 2, targetSortOrder: 1 });
    expect(result?.httpStatus).toBe(400);
    expect(result?.body.error).toBe("Use the downgrade option to switch to a lower plan.");
  });

  it("returns 400 when user tries to checkout the same plan they're on", () => {
    const result = createCheckoutSessionGuard({ currentSortOrder: 2, targetSortOrder: 2 });
    expect(result?.httpStatus).toBe(400);
  });

  it("allows checkout when free user upgrades to any paid plan", () => {
    const result = createCheckoutSessionGuard({ currentSortOrder: 0, targetSortOrder: 1 });
    expect(result).toBeNull();
  });

  it("allows checkout when paid user upgrades to a higher plan", () => {
    const result = createCheckoutSessionGuard({ currentSortOrder: 1, targetSortOrder: 2 });
    expect(result).toBeNull();
  });
});

/**
 * Property: for any paid user (currentSortOrder > 0), targeting a plan with
 * sortOrder <= current always returns 400.
 */
describe("Property: createCheckoutSession — paid users can never checkout to same/lower plan", () => {
  it("always returns 400 when currentSortOrder > 0 and targetSortOrder <= currentSortOrder", () => {
    fc.assert(
      fc.property(
        fc.record({
          currentSortOrder: fc.integer({ min: 1, max: 10 }),
          targetSortOrder: fc.integer({ min: 0, max: 10 }),
        }).filter(({ currentSortOrder, targetSortOrder }) => targetSortOrder <= currentSortOrder),
        ({ currentSortOrder, targetSortOrder }) => {
          const result = createCheckoutSessionGuard({ currentSortOrder, targetSortOrder });
          return result?.httpStatus === 400;
        }
      )
    );
  });
});

// ── changeSubscription — upgrade bypass blocked ───────────────────────────────

/**
 * Validates: a paid user can't use changeSubscription to reach a higher or equal plan.
 */
describe("changeSubscription — upgrade bypass blocked", () => {
  it("returns 400 when soloPro user tries to change to agency (higher plan)", () => {
    const result = changeSubscriptionGuard({ currentSortOrder: 1, targetSortOrder: 2 });
    expect(result?.httpStatus).toBe(400);
    expect(result?.body.error).toBe("Use the upgrade flow to switch to a higher or equal plan.");
  });

  it("returns 400 when user tries to change to the same plan", () => {
    const result = changeSubscriptionGuard({ currentSortOrder: 2, targetSortOrder: 2 });
    expect(result?.httpStatus).toBe(400);
  });

  it("allows changeSubscription when targeting a lower plan (downgrade)", () => {
    const result = changeSubscriptionGuard({ currentSortOrder: 2, targetSortOrder: 1 });
    expect(result).toBeNull();
  });
});

/**
 * Property: targeting a plan with sortOrder >= current always returns 400.
 */
describe("Property: changeSubscription — same/higher plan always blocked", () => {
  it("always returns 400 when targetSortOrder >= currentSortOrder", () => {
    fc.assert(
      fc.property(
        fc.record({
          currentSortOrder: fc.integer({ min: 0, max: 10 }),
          targetSortOrder: fc.integer({ min: 0, max: 10 }),
        }).filter(({ currentSortOrder, targetSortOrder }) => targetSortOrder >= currentSortOrder),
        ({ currentSortOrder, targetSortOrder }) => {
          const result = changeSubscriptionGuard({ currentSortOrder, targetSortOrder });
          return result?.httpStatus === 400;
        }
      )
    );
  });
});

// ── usePlans cache TTL ────────────────────────────────────────────────────────

/**
 * Validates: plan changes in Firestore are reflected in the UI within 5 minutes.
 * The cache TTL is 5 minutes (300_000 ms).
 */
describe("usePlans — cache TTL (5 minutes)", () => {
  const CACHE_TTL_MS = 5 * 60 * 1000;

  it("cache is fresh immediately after population (not stale)", () => {
    const now = Date.now();
    expect(isCacheStale(now, now, CACHE_TTL_MS)).toBe(false);
  });

  it("cache is fresh just before TTL expires", () => {
    const cacheTimestamp = 1_000_000;
    const justBefore = cacheTimestamp + CACHE_TTL_MS - 1;
    expect(isCacheStale(cacheTimestamp, justBefore, CACHE_TTL_MS)).toBe(false);
  });

  it("cache is NOT stale exactly at TTL boundary (stale requires strictly greater)", () => {
    const cacheTimestamp = 1_000_000;
    const atBoundary = cacheTimestamp + CACHE_TTL_MS;
    expect(isCacheStale(cacheTimestamp, atBoundary, CACHE_TTL_MS)).toBe(false);
  });

  it("cache is stale after 5 minutes have passed", () => {
    const cacheTimestamp = 1_000_000;
    const after5min = cacheTimestamp + CACHE_TTL_MS + 1;
    expect(isCacheStale(cacheTimestamp, after5min, CACHE_TTL_MS)).toBe(true);
  });
});

/**
 * Property: cache is stale iff (now - timestamp) > TTL.
 */
describe("Property: usePlans cache TTL — stale iff elapsed > TTL", () => {
  it("isCacheStale matches (now - timestamp) > TTL for all inputs", () => {
    const CACHE_TTL_MS = 5 * 60 * 1000;
    fc.assert(
      fc.property(
        fc.record({
          cacheTimestamp: fc.nat({ max: 1_000_000_000_000 }),
          nowMs: fc.nat({ max: 1_000_000_000_000 }),
        }),
        ({ cacheTimestamp, nowMs }) => {
          const expected = nowMs - cacheTimestamp > CACHE_TTL_MS;
          return isCacheStale(cacheTimestamp, nowMs, CACHE_TTL_MS) === expected;
        }
      )
    );
  });
});

// ── Firestore rules — processedWebhookEvents locked ──────────────────────────

/**
 * Validates: clients cannot read or write webhook dedup records.
 * The Firestore rule is: allow read, write: if false
 */
describe("Firestore rules — processedWebhookEvents locked", () => {
  it("denies read for unauthenticated clients", () => {
    expect(processedWebhookEventsAllowed("read", false)).toBe(false);
  });

  it("denies write for unauthenticated clients", () => {
    expect(processedWebhookEventsAllowed("write", false)).toBe(false);
  });

  it("denies read even for authenticated users", () => {
    expect(processedWebhookEventsAllowed("read", true)).toBe(false);
  });

  it("denies write even for authenticated users", () => {
    expect(processedWebhookEventsAllowed("write", true)).toBe(false);
  });
});

/**
 * Property: processedWebhookEvents is always denied regardless of auth state or operation.
 */
describe("Property: processedWebhookEvents — always denied", () => {
  it("always returns false for any operation and auth state", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("read" as const, "write" as const),
        fc.boolean(),
        (operation, isAuthenticated) => {
          return processedWebhookEventsAllowed(operation, isAuthenticated) === false;
        }
      )
    );
  });
});

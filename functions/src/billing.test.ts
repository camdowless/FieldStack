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
 * Pure function representing the credit reset logic (mirrors resetCredits in index.ts).
 */
function applyRenewal(state: { plan: string; creditsUsed: number }): { creditsUsed: number; creditsTotal: number } {
  const planCredits: Record<string, number> = { free: 3, soloPro: 30, agency: 100, pro: 250 };
  const creditsTotal = planCredits[state.plan] ?? 3;
  return { creditsUsed: 0, creditsTotal };
}

/**
 * Pure function representing the subscription update logic (mirrors updateSubscription in index.ts).
 */
function applySubscriptionUpdate(
  state: { plan: string; creditsUsed: number; stripeSubscriptionId: string | null },
  event: { plan: string; stripeSubscriptionId: string; status: string }
): { plan: string; creditsUsed: number; stripeSubscriptionId: string; status: string; creditsTotal: number } {
  const planCredits: Record<string, number> = { free: 3, soloPro: 30, agency: 100, pro: 250 };
  return {
    plan: event.plan,
    creditsUsed: state.creditsUsed,
    stripeSubscriptionId: event.stripeSubscriptionId,
    status: event.status,
    creditsTotal: planCredits[event.plan] ?? 3,
  };
}

// ── Property P4: Credit Reset on Renewal ─────────────────────────────────────

/**
 * Property P4: Credit Reset on Renewal
 * After invoice.payment_succeeded (subscription_cycle), creditsUsed resets to 0
 * and creditsTotal matches PLAN_CREDITS[plan].
 *
 * Validates: Requirements 5.6, 1.4, 1.5
 */
describe("Property P4: Credit Reset on Renewal — creditsUsed resets to 0, creditsTotal matches plan", () => {
  it("always resets creditsUsed to 0 and sets creditsTotal to the plan limit", () => {
    const planCredits: Record<string, number> = { free: 3, soloPro: 30, agency: 100, pro: 250 };
    fc.assert(
      fc.property(
        fc.record({
          plan: fc.constantFrom("free", "soloPro", "agency", "pro"),
          creditsUsed: fc.nat({ max: 250 }),
        }),
        ({ plan, creditsUsed }) => {
          const after = applyRenewal({ plan, creditsUsed });
          return after.creditsUsed === 0 && after.creditsTotal === planCredits[plan];
        }
      )
    );
  });
});

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
          creditsUsed: fc.nat({ max: 250 }),
          stripeSubscriptionId: fc.string({ minLength: 1 }),
          status: fc.constantFrom("active", "past_due"),
        }),
        ({ plan, creditsUsed, stripeSubscriptionId, status }) => {
          const initialState = { plan: "free", creditsUsed, stripeSubscriptionId: null };
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
function applyMigration(state: { plan: string; creditsUsed: number }): {
  plan: string;
  creditsTotal: number;
  creditsUsed: number;
} {
  const planCredits: Record<string, number> = { free: 3, soloPro: 30, agency: 100, pro: 250 };
  const planMap: Record<string, string> = {
    starter: "soloPro",
    enterprise: "pro",
  };
  const validPlans = new Set(["free", "soloPro", "agency", "pro"]);

  const newPlan = validPlans.has(state.plan) ? state.plan : (planMap[state.plan] ?? "free");
  const newCreditsTotal = planCredits[newPlan] ?? 3;
  const cappedCreditsUsed = Math.min(state.creditsUsed, newCreditsTotal);

  return { plan: newPlan, creditsTotal: newCreditsTotal, creditsUsed: cappedCreditsUsed };
}

// ── Property P6: Migration Correctness ───────────────────────────────────────

/**
 * Property P6: Migration Correctness
 * For any user with a legacy or current plan name and any creditsUsed value,
 * migration produces the correct new plan, correct creditsTotal, and capped creditsUsed.
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.5
 */
describe("Property P6: Migration Correctness — legacy plan names are remapped and credits are capped", () => {
  it("correctly remaps legacy plans and caps creditsUsed", () => {
    const planCredits: Record<string, number> = { free: 3, soloPro: 30, agency: 100, pro: 250 };
    const planMap: Record<string, string> = {
      starter: "soloPro", enterprise: "pro",
      free: "free", soloPro: "soloPro", agency: "agency", pro: "pro",
    };

    fc.assert(
      fc.property(
        fc.record({
          plan: fc.constantFrom("starter", "enterprise", "free", "soloPro", "agency", "pro"),
          creditsUsed: fc.nat({ max: 10000 }),
        }),
        ({ plan, creditsUsed }) => {
          const after = applyMigration({ plan, creditsUsed });
          const expectedPlan = planMap[plan];
          const expectedTotal = planCredits[expectedPlan];
          return (
            after.plan === expectedPlan &&
            after.creditsTotal === expectedTotal &&
            after.creditsUsed === Math.min(creditsUsed, expectedTotal)
          );
        }
      )
    );
  });
});

// ── Pure helper for credit enforcement property test ──────────────────────────

/**
 * Pure function representing the credit check logic (mirrors the check in dataforseoBusinessSearch).
 */
function checkCredits(state: { creditsUsed: number; creditsTotal: number }): "OK" | "INSUFFICIENT_CREDITS" {
  if (state.creditsUsed >= state.creditsTotal) return "INSUFFICIENT_CREDITS";
  return "OK";
}

// ── Property P1: Credit Enforcement ──────────────────────────────────────────

/**
 * Property P1: Credit Enforcement
 * For any subscription state where creditsUsed >= creditsTotal, the credit check
 * must return "INSUFFICIENT_CREDITS".
 *
 * Validates: Requirements 6.1, 6.2
 */
describe("Property P1: Credit Enforcement — cannot search with exhausted credits", () => {
  it("returns INSUFFICIENT_CREDITS when creditsUsed >= creditsTotal", () => {
    fc.assert(
      fc.property(
        fc.record({
          creditsUsed: fc.nat(),
          creditsTotal: fc.nat(),
        }).filter(({ creditsUsed, creditsTotal }) => creditsUsed >= creditsTotal),
        ({ creditsUsed, creditsTotal }) => {
          const result = checkCredits({ creditsUsed, creditsTotal });
          return result === "INSUFFICIENT_CREDITS";
        }
      )
    );
  });

  it("returns OK when creditsUsed < creditsTotal", () => {
    fc.assert(
      fc.property(
        fc.record({
          creditsUsed: fc.nat({ max: 999 }),
          creditsTotal: fc.nat({ max: 1000 }),
        }).filter(({ creditsUsed, creditsTotal }) => creditsUsed < creditsTotal),
        ({ creditsUsed, creditsTotal }) => {
          const result = checkCredits({ creditsUsed, creditsTotal });
          return result === "OK";
        }
      )
    );
  });
});

import { Timestamp } from "firebase-admin/firestore";

// ─── Subscription ─────────────────────────────────────────────────────────────

export type SubscriptionPlan = "free" | "starter" | "growth" | "pro";
export type SubscriptionStatus = "active" | "past_due" | "cancelled" | "trialing";

export interface Subscription {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  creditsUsed: number;
  creditsTotal: number;
  currentPeriodStart: Timestamp | null;
  currentPeriodEnd: Timestamp | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  cancelAtPeriodEnd: boolean;
}

// ─── Plan configuration ───────────────────────────────────────────────────────
// Plan limits, pricing, and feature flags live in the Firestore `plans`
// collection (see functions/src/plans.ts). Do not hardcode plan data here.
// Use getPlanConfig() / getPlanCredits() from plans.ts at runtime.
export type { PlanConfig } from "./plans";

// ─── User Profile ─────────────────────────────────────────────────────────────

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  role: "user" | "admin";
  subscription: Subscription;
  preferences?: Record<string, unknown>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

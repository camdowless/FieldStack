# Implementation Plan: Stripe Subscription Billing

## Overview

Implement Stripe-integrated subscription billing by updating the shared type definitions first, then adding backend Cloud Functions (checkout, portal, webhook, migration), then updating the frontend billing page and feature gates. Tests are co-located with the implementation tasks they validate.

## Tasks

- [x] 1. Update types and environment configuration
  - [x] 1.1 Update `functions/src/types.ts` — rename `SubscriptionPlan` union to `"free" | "soloPro" | "agency" | "pro"`, update `PLAN_CREDITS` to `{ free: 3, soloPro: 30, agency: 100, pro: 250 }`, add `STRIPE_PRICE_TO_PLAN` mapping (reads from env vars), remove legacy `"starter"` and `"enterprise"` values
    - _Requirements: 1.1, 1.2, 1.6, 12.3_
  - [x] 1.2 Add `functions/.env.example` entries: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_SOLOPRO`, `STRIPE_PRICE_AGENCY`, `STRIPE_PRICE_PRO`, `FRONTEND_URL`
    - _Requirements: 12.1, 12.2, 12.3_

- [x] 2. Create `planFeatures.ts` feature gate utility
  - [x] 2.1 Create `frontend/src/lib/planFeatures.ts` — export `SubscriptionPlan` type, `PlanFeatures` interface, `getPlanFeatures(plan)`, `canSaveLeads(plan)`, `canGenerateScripts(plan)` as pure functions matching the plan→feature table in the design
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_
  - [x] 2.2 Write property test for `getPlanFeatures` — **Property P2: Plan Feature Gating** — verify `canSaveLeads`/`canGenerateScripts` flags are deterministic and consistent with plan hierarchy for all four plans
    - **Property P2: Plan Feature Gating — Feature flags are deterministic and consistent with plan hierarchy**
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6, 2.7**
  - [x] 2.3 Write property test for `PLAN_CREDITS` ordering — **Property P5: Plan Credits Monotonicity** — verify `free < soloPro < agency < pro` credit ordering holds
    - **Property P5: Plan Credits Monotonicity — Higher-tier plans always have more credits**
    - **Validates: Requirements 1.2, 2.2, 2.3, 2.4, 2.5**

- [x] 3. Update `AuthContext.tsx` plan type
  - [x] 3.1 Update `Subscription` interface in `frontend/src/contexts/AuthContext.tsx` — change `plan` type from `"free" | "starter" | "pro" | "enterprise"` to `"free" | "soloPro" | "agency" | "pro"`
    - _Requirements: 1.1, 1.3_
  - [x] 3.2 Verify `useCredits` hook in `frontend/src/hooks/useCredits.ts` — confirm `plan` return type is compatible with the updated `SubscriptionPlan`; update type annotation if needed (no logic changes expected)
    - _Requirements: 1.1_

- [x] 4. Install Stripe SDK and add Cloud Function routes
  - [x] 4.1 Install `stripe` npm package in `functions/` (`npm install stripe` inside `functions/`)
    - _Requirements: 12.1_
  - [x] 4.2 Add `firebase.json` hosting rewrites for `/api/createCheckoutSession`, `/api/createPortalSession`, and `/api/stripeWebhook`
    - _Requirements: 3.1, 4.1, 5.1_

- [x] 5. Implement `createCheckoutSession` Cloud Function
  - [x] 5.1 Add `createCheckoutSession` to `functions/src/index.ts` — verify Firebase auth token via `verifyUserRole`, read user profile, create Stripe Customer if `stripeCustomerId` is null and persist it, validate `priceId` against `STRIPE_PRICE_TO_PLAN`, create `stripe.checkout.sessions.create` with `mode: "subscription"` and `uid` in metadata, return `{ url }`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 11.1, 11.2, 12.4_
  - [x] 5.2 Write property test for Stripe Customer idempotency — **Property P7: Stripe Customer Idempotency** — verify that when `stripeCustomerId` is already set, `createCheckoutSession` reuses it and does not call `stripe.customers.create`
    - **Property P7: Stripe Customer Idempotency — Existing stripeCustomerId is never overwritten**
    - **Validates: Requirements 11.2**

- [x] 6. Implement `createPortalSession` Cloud Function
  - [x] 6.1 Add `createPortalSession` to `functions/src/index.ts` — verify Firebase auth token, read `stripeCustomerId` from user profile, return HTTP 400 if null, call `stripe.billingPortal.sessions.create`, return `{ url }`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 7. Implement `stripeWebhook` Cloud Function
  - [x] 7.1 Add `stripeWebhook` to `functions/src/index.ts` — use raw body (no JSON body-parser), verify `Stripe-Signature` header via `stripe.webhooks.constructEvent` with `STRIPE_WEBHOOK_SECRET`, return HTTP 400 on failure
    - _Requirements: 5.1, 5.2, 9.1, 9.2, 9.3_
  - [x] 7.2 Implement `checkout.session.completed` handler — retrieve Stripe Subscription, resolve plan from `STRIPE_PRICE_TO_PLAN`, call `updateSubscription` helper to write plan/status/creditsTotal/stripeSubscriptionId/cancelAtPeriodEnd/period timestamps to `users/{uid}/subscription`
    - _Requirements: 5.3, 1.4_
  - [x] 7.3 Implement `customer.subscription.updated` handler — call `lookupUidByCustomerId`, resolve new plan, call `updateSubscription`
    - _Requirements: 5.4_
  - [x] 7.4 Implement `customer.subscription.deleted` handler — call `lookupUidByCustomerId`, reset subscription to free plan defaults via `downgradeToFree` helper
    - _Requirements: 5.5_
  - [x] 7.5 Implement `invoice.payment_succeeded` handler — only act when `billing_reason === "subscription_cycle"`, call `lookupUidByCustomerId`, call `resetCredits` helper to set `creditsUsed=0`, `creditsTotal=PLAN_CREDITS[plan]`, and update period timestamps
    - _Requirements: 5.6, 1.4, 1.5, 6.4_
  - [x] 7.6 Implement `invoice.payment_failed` handler — call `lookupUidByCustomerId`, set `subscription.status = "past_due"`
    - _Requirements: 5.7_
  - [x] 7.7 Implement `lookupUidByCustomerId` helper — query `users` collection where `subscription.stripeCustomerId == stripeCustomerId`, limit 1, return uid or null; log and return HTTP 200 if null (prevent Stripe retries)
    - _Requirements: 5.10_
  - [x] 7.8 Write property test for credit reset — **Property P4: Credit Reset on Renewal** — verify that after `resetCredits`, `creditsUsed === 0` and `creditsTotal === PLAN_CREDITS[plan]` for all plans and any prior `creditsUsed` value
    - **Property P4: Credit Reset on Renewal — creditsUsed resets to 0, creditsTotal matches plan**
    - **Validates: Requirements 5.6, 1.4, 1.5**
  - [x] 7.9 Write property test for webhook idempotency — **Property P3: Webhook Idempotency** — verify that applying the same webhook event twice produces the same Firestore subscription state
    - **Property P3: Webhook Idempotency — Duplicate events produce identical Firestore state**
    - **Validates: Requirements 5.9**

- [x] 8. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Add Firestore index for `stripeCustomerId` lookup
  - [x] 9.1 Add a single-field index on `users` collection for `subscription.stripeCustomerId` in `firestore.indexes.json` to support the `lookupUidByCustomerId` query without a full collection scan
    - _Requirements: 5.4, 5.5, 5.6, 5.7_

- [x] 10. Implement `migrateSubscriptionPlans` Cloud Function
  - [x] 10.1 Add `migrateSubscriptionPlans` to `functions/src/index.ts` — admin-only HTTP function (call `verifyAdmin`), iterate all `users` documents, map `"starter" → "soloPro"` and `"enterprise" → "pro"`, skip already-valid plan names, update `creditsTotal` to `PLAN_CREDITS[newPlan]`, cap `creditsUsed` to new `creditsTotal`, write in Firestore batch writes (max 500 per batch)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_
  - [x] 10.2 Write property test for migration correctness — **Property P6: Migration Correctness** — verify that for any user with a legacy or current plan name and any `creditsUsed` value, migration produces the correct new plan, correct `creditsTotal`, and capped `creditsUsed`
    - **Property P6: Migration Correctness — Legacy plan names are remapped and credits are capped**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.5**

- [x] 11. Update credit enforcement for new plan names
  - [x] 11.1 Verify the existing credit check transaction in `dataforseoBusinessSearch` (`functions/src/index.ts`) still compiles and works correctly with the updated `SubscriptionPlan` type — no logic changes needed, only confirm type compatibility
    - _Requirements: 6.1, 6.2, 6.3_
  - [x] 11.2 Write property test for credit enforcement — **Property P1: Credit Enforcement** — verify that for any subscription state where `creditsUsed >= creditsTotal`, the credit check returns `"INSUFFICIENT_CREDITS"`
    - **Property P1: Credit Enforcement — Cannot search with exhausted credits**
    - **Validates: Requirements 6.1, 6.2**

- [x] 12. Update `Billing.tsx` frontend page
  - [x] 12.1 Replace `PLAN_DETAILS` constant in `frontend/src/pages/Billing.tsx` with the four new plans: Free ($0/3 searches), SoloPro ($19/mo/30 searches), Agency ($49/mo/100 searches), Pro ($99/mo/250 searches) with correct feature lists per the design
    - _Requirements: 7.1_
  - [x] 12.2 Add upgrade button click handler — call `createCheckoutSession` with the plan's Stripe Price ID (read from `import.meta.env`), redirect to returned URL; disable button for current plan
    - _Requirements: 7.2, 7.3_
  - [x] 12.3 Add "Manage Subscription" button — show only when `profile?.subscription.stripeSubscriptionId` is non-null; on click call `createPortalSession` and redirect to returned URL
    - _Requirements: 7.4, 7.5_
  - [x] 12.4 Remove hardcoded mock invoice history and payment method sections; keep credit usage progress bar wired to `useCredits()` hook; ensure `onSnapshot` updates (already handled by `AuthContext`) reflect in the UI without page reload
    - _Requirements: 7.6, 7.7_

- [x] 13. Apply feature gating in UI
  - [x] 13.1 In `frontend/src/components/LeadCard.tsx` (or wherever the save-lead action is rendered), import `canSaveLeads` from `planFeatures.ts` and replace the save button with an upgrade prompt when `canSaveLeads(plan)` returns `false`
    - _Requirements: 8.1, 8.3_
  - [x] 13.2 In the script generation UI (locate the component rendering the script/AI prompt action), import `canGenerateScripts` from `planFeatures.ts` and replace the action with an upgrade prompt when `canGenerateScripts(plan)` returns `false`
    - _Requirements: 8.2, 8.4_

- [x] 14. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Property tests use `fast-check` — install in `frontend/` if not already present (`npm install --save-dev fast-check`)
- `STRIPE_PRICE_SOLOPRO`, `STRIPE_PRICE_AGENCY`, `STRIPE_PRICE_PRO` must be set in `functions/.env` before deploying Cloud Functions
- The `stripeWebhook` function must be excluded from Firebase Hosting rewrites that apply `express.json()` body parsing — use `functions.https.onRequest` directly with `req.rawBody`
- Run `migrateSubscriptionPlans` once before deploying to production to migrate legacy `starter`/`enterprise` users
- Each task references specific requirements for traceability

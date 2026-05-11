# Requirements Document

## Introduction

This feature replaces the existing stub subscription model with a fully functional Stripe-integrated billing system. The platform will support four subscription tiers (Free, SoloPro, Agency, Pro) with per-plan search credit limits and feature flags. New subscriptions are created via Stripe Checkout, existing subscriptions are managed via the Stripe Customer Portal, and Stripe Webhooks keep Firestore subscription state authoritative. Existing users on legacy plan names (`starter`, `enterprise`) are migrated to the new plan names via a one-time migration function.

## Glossary

- **Billing_System**: The complete Stripe-integrated subscription billing feature described in this document.
- **Checkout_Function**: The `createCheckoutSession` Cloud Function that creates a Stripe Checkout session.
- **Portal_Function**: The `createPortalSession` Cloud Function that creates a Stripe Customer Portal session.
- **Webhook_Handler**: The `stripeWebhook` Cloud Function that processes Stripe webhook events.
- **Billing_Page**: The `Billing.tsx` frontend page component.
- **Feature_Gate**: The `planFeatures.ts` utility module that derives feature availability from a plan name.
- **Migration_Function**: The one-time Cloud Function that migrates users from legacy plan names to new plan names.
- **SubscriptionPlan**: One of the four plan identifiers: `free`, `soloPro`, `agency`, `pro`.
- **PLAN_CREDITS**: The authoritative mapping of SubscriptionPlan to monthly search credit limits: `free=3`, `soloPro=30`, `agency=100`, `pro=250`.
- **Subscription**: The Firestore sub-object on `users/{uid}` that holds plan, status, credit counters, period timestamps, and Stripe identifiers.
- **stripeCustomerId**: The Stripe Customer ID stored on the user's Subscription object; set once on first checkout.
- **stripeSubscriptionId**: The Stripe Subscription ID stored on the user's Subscription object; null for free-plan users.
- **creditsUsed**: The number of searches consumed in the current billing period.
- **creditsTotal**: The maximum searches allowed in the current billing period; must equal `PLAN_CREDITS[plan]` after any webhook update.
- **Stripe_Signature**: The `Stripe-Signature` HTTP header sent by Stripe on every webhook POST.
- **STRIPE_WEBHOOK_SECRET**: The endpoint-specific signing secret used to verify Stripe_Signature.

## Requirements

### Requirement 1: Subscription Plan Data Model

**User Story:** As a developer, I want a well-defined subscription data model, so that plan state is consistent across the backend and frontend.

#### Acceptance Criteria

1. THE Billing_System SHALL define `SubscriptionPlan` as the union type `"free" | "soloPro" | "agency" | "pro"`.
2. THE Billing_System SHALL define `PLAN_CREDITS` as `{ free: 3, soloPro: 30, agency: 100, pro: 250 }`.
3. THE Billing_System SHALL define the `Subscription` interface with fields: `plan`, `status`, `creditsUsed`, `creditsTotal`, `currentPeriodStart`, `currentPeriodEnd`, `stripeCustomerId`, `stripeSubscriptionId`, and `cancelAtPeriodEnd`.
4. WHEN a Subscription object is written by the Webhook_Handler, THE Billing_System SHALL ensure `creditsTotal` equals `PLAN_CREDITS[plan]`.
5. WHEN a Subscription object is written by the Webhook_Handler, THE Billing_System SHALL ensure `creditsUsed` is greater than or equal to zero and less than or equal to `creditsTotal`.
6. THE Billing_System SHALL define `STRIPE_PRICE_TO_PLAN` as a mapping from Stripe Price IDs (read from environment variables) to SubscriptionPlan values.

---

### Requirement 2: Feature Flag Derivation

**User Story:** As a developer, I want feature availability derived from the plan name at runtime, so that no separate feature flags need to be stored in Firestore.

#### Acceptance Criteria

1. THE Feature_Gate SHALL expose a `getPlanFeatures(plan: SubscriptionPlan): PlanFeatures` pure function.
2. WHEN `plan` is `"free"`, THE Feature_Gate SHALL return `{ searches: 3, canSaveLeads: false, canGenerateScripts: false }`.
3. WHEN `plan` is `"soloPro"`, THE Feature_Gate SHALL return `{ searches: 30, canSaveLeads: true, canGenerateScripts: false }`.
4. WHEN `plan` is `"agency"`, THE Feature_Gate SHALL return `{ searches: 100, canSaveLeads: true, canGenerateScripts: true }`.
5. WHEN `plan` is `"pro"`, THE Feature_Gate SHALL return `{ searches: 250, canSaveLeads: true, canGenerateScripts: true }`.
6. THE Feature_Gate SHALL expose `canSaveLeads(plan: SubscriptionPlan): boolean` returning `true` if and only if `plan` is not `"free"`.
7. THE Feature_Gate SHALL expose `canGenerateScripts(plan: SubscriptionPlan): boolean` returning `true` if and only if `plan` is `"agency"` or `"pro"`.

---

### Requirement 3: Create Checkout Session

**User Story:** As a user, I want to start a Stripe Checkout flow when I click an upgrade button, so that I can subscribe to a paid plan with a secure, Stripe-hosted payment page.

#### Acceptance Criteria

1. WHEN a POST request is received at `createCheckoutSession`, THE Checkout_Function SHALL verify the Firebase auth token before processing the request.
2. IF the Firebase auth token is missing or invalid, THEN THE Checkout_Function SHALL return HTTP 401.
3. WHEN the auth token is valid, THE Checkout_Function SHALL read the user's Firestore profile to retrieve `stripeCustomerId`.
4. IF `stripeCustomerId` is null, THEN THE Checkout_Function SHALL create a new Stripe Customer and persist the resulting `stripeCustomerId` to `users/{uid}/subscription.stripeCustomerId` before creating the session.
5. WHEN creating the Stripe Checkout session, THE Checkout_Function SHALL use `mode: "subscription"` and include the `uid` in session metadata.
6. WHEN the Stripe Checkout session is created successfully, THE Checkout_Function SHALL return HTTP 200 with `{ url: string }` containing the Stripe-hosted checkout URL.
7. IF the `priceId` in the request body is not a recognized Stripe Price ID, THEN THE Checkout_Function SHALL return HTTP 400 with `{ error: "Invalid plan selected" }`.
8. IF the user's Firestore profile does not exist, THEN THE Checkout_Function SHALL return HTTP 404.

---

### Requirement 4: Create Portal Session

**User Story:** As a paid subscriber, I want to access the Stripe Customer Portal, so that I can cancel or change my subscription and update my payment method without contacting support.

#### Acceptance Criteria

1. WHEN a POST request is received at `createPortalSession`, THE Portal_Function SHALL verify the Firebase auth token before processing the request.
2. IF the Firebase auth token is missing or invalid, THEN THE Portal_Function SHALL return HTTP 401.
3. WHEN the auth token is valid, THE Portal_Function SHALL read `stripeCustomerId` from the user's Firestore profile.
4. IF `stripeCustomerId` is null, THEN THE Portal_Function SHALL return HTTP 400 with `{ error: "No active subscription to manage" }`.
5. WHEN `stripeCustomerId` is present, THE Portal_Function SHALL create a Stripe Customer Portal session and return HTTP 200 with `{ url: string }`.

---

### Requirement 5: Stripe Webhook Processing

**User Story:** As a system operator, I want Stripe webhook events to keep Firestore subscription state authoritative, so that plan changes, cancellations, and renewals are reflected immediately without manual intervention.

#### Acceptance Criteria

1. WHEN a POST request is received at `stripeWebhook`, THE Webhook_Handler SHALL verify the `Stripe-Signature` header using `stripe.webhooks.constructEvent` with `STRIPE_WEBHOOK_SECRET`.
2. IF signature verification fails, THEN THE Webhook_Handler SHALL return HTTP 400 and make no Firestore writes.
3. WHEN a `checkout.session.completed` event is received, THE Webhook_Handler SHALL retrieve the Stripe Subscription, resolve the SubscriptionPlan from `STRIPE_PRICE_TO_PLAN`, and update `users/{uid}/subscription` with the new plan, status, creditsTotal, stripeSubscriptionId, cancelAtPeriodEnd, and period timestamps.
4. WHEN a `customer.subscription.updated` event is received, THE Webhook_Handler SHALL look up the uid by `stripeCustomerId`, resolve the new plan, and update `users/{uid}/subscription` accordingly.
5. WHEN a `customer.subscription.deleted` event is received, THE Webhook_Handler SHALL look up the uid by `stripeCustomerId` and reset the user's subscription to the `free` plan defaults.
6. WHEN an `invoice.payment_succeeded` event is received with `billing_reason === "subscription_cycle"`, THE Webhook_Handler SHALL reset `creditsUsed` to 0, set `creditsTotal` to `PLAN_CREDITS[plan]`, and update the period timestamps.
7. WHEN an `invoice.payment_failed` event is received, THE Webhook_Handler SHALL set `subscription.status` to `"past_due"` for the affected user.
8. WHEN any supported webhook event is processed successfully, THE Webhook_Handler SHALL return HTTP 200 with `{ received: true }`.
9. WHEN the same webhook event is processed more than once, THE Webhook_Handler SHALL produce the same Firestore state as the first processing (idempotent).
10. IF `lookupUidByCustomerId` returns null for a webhook event, THEN THE Webhook_Handler SHALL log the error and return HTTP 200 to prevent Stripe from retrying indefinitely.

---

### Requirement 6: Credit Enforcement

**User Story:** As a system operator, I want search credits enforced atomically, so that users cannot exceed their plan's monthly search limit.

#### Acceptance Criteria

1. WHEN a search request is received, THE Billing_System SHALL check `creditsUsed >= creditsTotal` inside a Firestore transaction before allowing the search to proceed.
2. IF `creditsUsed >= creditsTotal`, THEN THE Billing_System SHALL return HTTP 402 with `{ error: "Insufficient credits. Please upgrade your plan.", code: "INSUFFICIENT_CREDITS" }`.
3. WHEN a search is allowed, THE Billing_System SHALL atomically increment `creditsUsed` by 1 within the same Firestore transaction.
4. WHILE a billing period is active, THE Billing_System SHALL NOT reset `creditsUsed` except via an `invoice.payment_succeeded` webhook with `billing_reason === "subscription_cycle"`.

---

### Requirement 7: Billing Page UI

**User Story:** As a user, I want a billing page that shows my current plan, credit usage, and upgrade options, so that I can understand my subscription status and take action.

#### Acceptance Criteria

1. THE Billing_Page SHALL display the four plan cards: Free ($0), SoloPro ($19/mo), Agency ($49/mo), and Pro ($99/mo) with their correct feature lists.
2. THE Billing_Page SHALL highlight the user's current plan card with a visual indicator.
3. WHEN a user clicks an upgrade button on a non-current plan card, THE Billing_Page SHALL call `createCheckoutSession` with the corresponding Stripe Price ID and redirect to the returned URL.
4. WHEN `stripeSubscriptionId` is non-null on the user's profile, THE Billing_Page SHALL display a "Manage Subscription" button.
5. WHEN a user clicks "Manage Subscription", THE Billing_Page SHALL call `createPortalSession` and redirect to the returned URL.
6. THE Billing_Page SHALL display the user's current `creditsUsed` and `creditsTotal` with a progress indicator.
7. WHEN the user's Firestore profile updates via `onSnapshot`, THE Billing_Page SHALL reflect the updated plan and credit values without a page reload.

---

### Requirement 8: Feature Gating in UI

**User Story:** As a user, I want gated features to show upgrade prompts when my plan does not include them, so that I understand what I need to upgrade to unlock additional capabilities.

#### Acceptance Criteria

1. WHEN `canSaveLeads(plan)` returns `false`, THE Billing_System SHALL display an upgrade prompt in place of the save-lead action.
2. WHEN `canGenerateScripts(plan)` returns `false`, THE Billing_System SHALL display an upgrade prompt in place of the script-generation action.
3. WHEN `canSaveLeads(plan)` returns `true`, THE Billing_System SHALL display the save-lead action without an upgrade prompt.
4. WHEN `canGenerateScripts(plan)` returns `true`, THE Billing_System SHALL display the script-generation action without an upgrade prompt.

---

### Requirement 9: Webhook Signature Security

**User Story:** As a system operator, I want all webhook requests verified with Stripe's signature mechanism, so that only legitimate Stripe events can modify subscription state.

#### Acceptance Criteria

1. THE Webhook_Handler SHALL use the raw (unparsed) request body when calling `stripe.webhooks.constructEvent`.
2. THE Webhook_Handler SHALL read `STRIPE_WEBHOOK_SECRET` exclusively from environment variables and never from client-supplied data.
3. IF the `Stripe-Signature` header is absent, THEN THE Webhook_Handler SHALL return HTTP 400 without processing the event.
4. THE Billing_System SHALL ensure that subscription state in Firestore can only be written by Cloud Functions using the Firebase Admin SDK, not by client-side code.

---

### Requirement 10: Migration of Legacy Plan Names

**User Story:** As a system operator, I want existing users on legacy plan names migrated to the new plan names, so that the system remains consistent after the plan rename.

#### Acceptance Criteria

1. WHEN the Migration_Function is executed, THE Migration_Function SHALL map `"starter"` to `"soloPro"` and `"enterprise"` to `"pro"` for all existing user documents.
2. WHEN migrating a user, THE Migration_Function SHALL update `creditsTotal` to `PLAN_CREDITS[newPlan]`.
3. WHEN migrating a user, THE Migration_Function SHALL preserve `creditsUsed` but cap it to the new `creditsTotal` if it exceeds the new limit.
4. WHEN the Migration_Function is executed, THE Migration_Function SHALL process all users in Firestore batch writes.
5. IF a user's plan is already a valid new plan name (`free`, `soloPro`, `agency`, `pro`), THEN THE Migration_Function SHALL leave that user's plan unchanged.

---

### Requirement 11: Stripe Customer ID Persistence

**User Story:** As a system operator, I want each user's Stripe Customer ID stored once and never changed, so that Stripe and Firestore remain consistently linked.

#### Acceptance Criteria

1. WHEN a user completes their first checkout, THE Checkout_Function SHALL store the `stripeCustomerId` on `users/{uid}/subscription.stripeCustomerId`.
2. WHEN `stripeCustomerId` is already set on a user's profile, THE Checkout_Function SHALL reuse the existing value and SHALL NOT create a new Stripe Customer.
3. THE Billing_System SHALL ensure `stripeCustomerId` is null for users who have never initiated a checkout.

---

### Requirement 12: Environment Configuration

**User Story:** As a developer, I want all Stripe credentials and Price IDs stored in environment variables, so that test and production environments can differ without code changes.

#### Acceptance Criteria

1. THE Billing_System SHALL read `STRIPE_SECRET_KEY` from environment variables to initialize the Stripe SDK.
2. THE Billing_System SHALL read `STRIPE_WEBHOOK_SECRET` from environment variables for webhook signature verification.
3. THE Billing_System SHALL read `STRIPE_PRICE_SOLOPRO`, `STRIPE_PRICE_AGENCY`, and `STRIPE_PRICE_PRO` from environment variables to populate `STRIPE_PRICE_TO_PLAN`.
4. IF any required Stripe environment variable is absent at function startup, THE Billing_System SHALL log an error and reject requests that depend on the missing variable.

# Stripe & Third-Party API Documentation

---

## Stripe

### Overview

Stripe handles all payment processing. The integration uses:

- **Stripe Checkout** for new subscriptions (hosted payment page)
- **Stripe Customer Portal** for upgrades, downgrades, payment method updates, and cancellations
- **Stripe Webhooks** to keep Firestore in sync with Stripe state
- **Stripe Invoices API** for invoice history

### Setup

1. Create a Stripe account at [stripe.com](https://stripe.com)
2. In test mode, go to **Developers -> API Keys** and copy your secret key
3. Create products and prices for each plan (Pro, Agency, Enterprise) - both monthly and annual
4. Copy the Price IDs into `functions/.env`
5. Run `bun run seed:plans` to write the plan configs to Firestore

### Environment Variables

```env
STRIPE_SECRET_KEY=sk_test_...          # or sk_live_... in production
STRIPE_WEBHOOK_SECRET=whsec_...        # from Stripe Dashboard -> Webhooks

# Price IDs - one per plan per billing interval
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_PRO_ANNUAL=price_...
STRIPE_PRICE_AGENCY=price_...
STRIPE_PRICE_AGENCY_ANNUAL=price_...
STRIPE_PRICE_ENTERPRISE=price_...
STRIPE_PRICE_ENTERPRISE_ANNUAL=price_...
```

### Webhook Setup

**Local development:**

Install the [Stripe CLI](https://stripe.com/docs/stripe-cli) and run:

```bash
stripe listen --forward-to localhost:5001/YOUR_PROJECT_ID/us-central1/stripeWebhook
```

Copy the webhook signing secret it prints into `functions/.env` as `STRIPE_WEBHOOK_SECRET`.

**Production:**

1. Go to Stripe Dashboard -> Developers -> Webhooks
2. Add endpoint: `https://your-app.web.app/api/stripeWebhook`
3. Select these events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Copy the signing secret into your production environment

### Webhook Handler

The webhook handler in `functions/src/index.ts` (`stripeWebhook`):

1. Verifies the `stripe-signature` header using `STRIPE_WEBHOOK_SECRET`
2. Checks `processedWebhookEvents/{eventId}` for idempotency (prevents double-processing on Stripe retries)
3. Writes the event ID to `processedWebhookEvents` before processing
4. Handles these events:

| Event | Action |
|---|---|
| `checkout.session.completed` | Retrieves subscription, updates `users/{uid}.subscription` |
| `customer.subscription.updated` | Updates plan, status, credits, period dates |
| `customer.subscription.deleted` | Downgrades to free plan, clears subscription IDs |
| `invoice.payment_failed` | Sets `subscription.status = "past_due"` |

### Subscription Sync

On every page load, `AuthContext` fires `POST /api/syncSubscription` (throttled to once per 5 minutes via `sessionStorage`). This reconciles Stripe state to Firestore in case a webhook was missed or delayed.

### Plan Configuration

Plans are stored in Firestore `plans/{planId}` and cached in-memory in `functions/src/plans.ts`. The frontend reads them via `usePlans()`.

To update plan pricing or features:
1. Update `functions/scripts/seedPlans.mjs`
2. Run `bun run seed:plans` (or `seed:plans:prod` for production)
3. The cache invalidates automatically within 5 minutes

To add a new plan:
1. Create the product and price in Stripe
2. Add the plan to `PLANS` in `seedPlans.mjs` and `buildPlanSeedData()` in `seedPlans.ts`
3. Add the plan ID to the `SubscriptionPlan` type in `functions/src/types.ts` and `frontend/src/contexts/AuthContext.tsx`
4. Run `bun run seed:plans`

### Stripe Customer Portal

The Customer Portal is used for:
- Upgrading between paid plans (with proration)
- Switching billing intervals (monthly <-> annual)
- Updating payment methods
- Viewing billing history

The portal is configured in your Stripe Dashboard under **Settings -> Billing -> Customer Portal**. Enable the features you want to expose.

### Testing Stripe

Use Stripe's test card numbers:
- `4242 4242 4242 4242` - successful payment
- `4000 0000 0000 9995` - payment declined
- `4000 0025 0000 3155` - requires 3D Secure

Use any future expiry date and any 3-digit CVC.

---

## Firebase Auth

### Providers

Two providers are configured:

- **Email/Password** - with email verification required before app access
- **Google OAuth** - pre-verified, skips email gate

To add more providers (GitHub, Apple, etc.):
1. Enable the provider in Firebase Console -> Authentication -> Sign-in method
2. Add the sign-in method to `AuthContext.tsx` following the Google pattern
3. Add a button to `Login.tsx` and `SignUpModal.tsx`

### Custom Claims

The `onUserCreate` trigger sets `{ role: "user" }` as a custom claim on every new account. Admin role is granted manually via `functions/scripts/bootstrap-admin.ts`.

Claims are read from the ID token in Cloud Functions via `decoded.claims.role`. On the frontend, `AuthContext` polls for the claim after profile creation (up to 8 seconds).

To add a new role:
1. Add it to the `role` union type in `functions/src/types.ts` and `AuthContext.tsx`
2. Update `checkUserRole()` and `checkAdminRole()` in `functions/src/authHelpers.ts`
3. Update `firestore.rules` if the new role needs different data access

### Email Verification

Email/password users must verify their email before accessing the app. The flow:

1. User signs up -> `VerifyEmailScreen` is shown
2. User clicks "Send verification email" -> `resendVerificationEmail` callable
3. Callable calls `admin.auth().generateEmailVerificationLink()` and sends via Resend
4. User clicks link -> Firebase verifies the email
5. `AuthContext` polls `emailVerified` -> app unlocks

Rate limit: 3 emails per 2 minutes per user (to absorb React StrictMode double-mounts without hitting Firebase's own limit).

---

## Resend

### Setup

1. Create an account at [resend.com](https://resend.com)
2. Add and verify your sending domain (DNS records)
3. Create an API key with "Sending access"
4. Add to `functions/.env`:

```env
RESEND_API_KEY=re_...
EMAIL_FROM=noreply@yourdomain.com
```

### Emails Sent

| Trigger | Subject | Template |
|---|---|---|
| Email verification | `Verify your email - {APP_NAME}` | `verificationEmailHtml()` |
| Password reset | `Reset your {APP_NAME} password` | `passwordResetEmailHtml()` |
| MFA sign-in code | `Your {APP_NAME} sign-in code` | `mfaEmailHtml()` |
| Support ticket | `[Support] {subject}` | Inline HTML in `emailService.ts` |

### Customizing Templates

Templates are in `functions/src/emailTemplates.ts`. They are plain HTML strings - no template engine.

The `APP_NAME` and `APP_URL` are read from environment variables at render time, so no code changes are needed when rebranding.

To add a new email:

```typescript
// In emailTemplates.ts
export function myNewEmailHtml(param: string): string {
  return layout(`
    <h1>My Email</h1>
    <p>Hello, ${param}</p>
  `);
}

// In emailService.ts
export async function sendMyNewEmail(to: string, param: string): Promise<void> {
  const { myNewEmailHtml } = await import("./emailTemplates");
  const result = await getResend().emails.send({
    from: FROM,
    to,
    subject: `My email subject - ${APP_NAME}`,
    html: myNewEmailHtml(param),
  });
  if (result.error) throw new Error(`Resend error: ${result.error.message}`);
}
```

---

## Google Places API

The template does not include Google Places by default. If you need location autocomplete (as in the original app), add it back:

1. Enable "Places API (New)" in Google Cloud Console
2. Create an API key restricted to your domain
3. Add `GOOGLE_PLACES_API_KEY` to your environment
4. Implement the autocomplete component following the original `LocationAutocomplete.tsx`

---

## Adding a New Third-Party Integration

Follow this pattern:

1. Add the SDK to `functions/package.json` with a pinned version
2. Create a lazy singleton getter (like `getStripe()` or `getResend()`) to avoid cold-start overhead
3. Read credentials from environment variables - never hardcode
4. Add the env var to `functions/.env.example` with a comment
5. Add the env var to the CI workflow's "Inject secrets" step
6. Log initialization status in the startup diagnostics block at the top of `index.ts`

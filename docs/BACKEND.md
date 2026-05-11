# Backend & Database Documentation

The backend is Firebase Cloud Functions (Node 22, Gen 1) with Firestore as the database. All functions live in `functions/src/index.ts`. Firestore security rules live in `firestore.rules`.

---

## Functions Overview

All exported functions and their HTTP paths:

### Auth

| Function | Trigger | Description |
|---|---|---|
| `onUserCreate` | `auth.user().onCreate` | Sets `role: "user"` custom claim, creates `users/{uid}` profile doc |
| `sendPasswordReset` | Callable | Rate-limited password reset email via Resend |
| `resendVerificationEmail` | Callable | Rate-limited verification email via Resend |
| `deleteUserAccount` | Callable | Cancels Stripe sub, deletes Firestore data, deletes Auth account |

### Billing

| Function | Path | Method | Description |
|---|---|---|---|
| `createCheckoutSession` | `/api/createCheckoutSession` | POST | Creates Stripe Checkout Session for new subscriptions |
| `createPortalSession` | `/api/createPortalSession` | POST | Opens Stripe Customer Portal (optionally with upgrade flow) |
| `stripeWebhook` | `/api/stripeWebhook` | POST | Handles Stripe events, updates Firestore subscription |
| `changeSubscription` | `/api/changeSubscription` | POST | Opens Stripe portal for plan changes |
| `cancelSubscription` | `/api/cancelSubscription` | POST | Sets `cancel_at_period_end: true` |
| `reactivateSubscription` | `/api/reactivateSubscription` | POST | Removes cancellation |
| `syncSubscription` | `/api/syncSubscription` | POST | Reconciles Stripe -> Firestore (called on page load) |
| `getInvoices` | `/api/getInvoices` | GET | Returns paginated invoice history from Stripe |

### Items (canonical example)

| Function | Path | Methods | Description |
|---|---|---|---|
| `itemsApi` | `/api/items`, `/api/items/:id` | GET, POST, PATCH, DELETE | Full CRUD for user's items |

### Admin

| Function | Path | Method | Description |
|---|---|---|---|
| `getAdminStats` | `/api/admin-stats` | GET | Returns platform stats from `admin/stats` doc |
| `seedPlans` | (admin callable) | POST | Seeds/updates `plans` collection from `buildPlanSeedData()` |
| `triggerBackup` | `/api/triggerBackup` | POST | Triggers Firestore export to GCS bucket |

### Support & Monitoring

| Function | Path | Method | Description |
|---|---|---|---|
| `submitSupportTicket` | `/api/support` | POST | Sends support email via Resend |
| `reportFrontendError` | `/api/report-error` | POST | Logs frontend errors to Cloud Logging |

---

## Adding a New Function

Copy this pattern:

```typescript
export const myNewFunction = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    // 1. Method check
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    // 2. Auth check
    let decoded: admin.auth.DecodedIdToken;
    try { decoded = await verifyUserRole(req); } catch { res.status(401).json({ error: "Unauthorized." }); return; }
    const uid = decoded.uid;

    // 3. Ensure profile exists
    await ensureUserProfile(uid);

    // 4. Rate limit (optional)
    const resetAt = await checkRateLimit(uid, "myNewFunction", 10);
    if (resetAt !== null) { replyRateLimited(res, resetAt); return; }

    // 5. Input validation
    const title = sanitizeString(req.body?.title, 200);
    if (!title) { res.status(400).json({ error: "title is required." }); return; }

    // 6. Business logic
    const ref = await db.collection("users").doc(uid).collection("my-resource").add({
      title,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(201).json({ id: ref.id });
  });
});
```

Then add a rewrite in `firebase.json`:

```json
{ "source": "/api/my-new-function", "function": "myNewFunction" }
```

---

## Firestore Schema

### `users/{uid}`

```typescript
{
  uid: string,
  email: string | null,
  displayName: string | null,
  photoURL: string | null,
  company: string | null,
  role: "user" | "admin",
  subscription: {
    plan: "free" | "pro" | "agency" | "enterprise",
    status: "active" | "past_due" | "cancelled" | "trialing",
    creditsUsed: number,
    creditsTotal: number,
    currentPeriodStart: Timestamp | null,
    currentPeriodEnd: Timestamp | null,
    stripeCustomerId: string | null,
    stripeSubscriptionId: string | null,
    stripePriceId: string | null,
    cancelAtPeriodEnd: boolean,
  },
  preferences: {
    itemsPerPage: number,
    // Add your app-specific preferences here
  },
  createdAt: Timestamp,
  updatedAt: Timestamp,
}
```

**Write rules:** Only `preferences`, `displayName`, `company`, and `updatedAt` can be written by the client. Everything else is server-only.

### `users/{uid}/items/{itemId}`

```typescript
{
  title: string,
  description: string,
  status: "active" | "archived",
  createdAt: Timestamp,
  updatedAt: Timestamp,
}
```

This is the canonical example subcollection. Add your own following this pattern.

### `plans/{planId}`

```typescript
{
  id: string,                    // "free" | "pro" | "agency" | "enterprise"
  name: string,
  priceUsdCents: number,
  annualPriceUsdCents: number | null,
  stripePriceId: string | null,
  stripePriceIdAnnual: string | null,
  creditsPerMonth: number,
  canSaveLeads: boolean,
  canGenerateScripts: boolean,
  canEnrichContacts: boolean,
  features: string[],
  sortOrder: number,
  active: boolean,
}
```

Plans are seeded by `functions/scripts/seedPlans.mjs`. They are read-only from the client and cached in-memory in `functions/src/plans.ts` with a 5-minute TTL.

### `rateLimits/{uid_fnName}`

```typescript
{
  count: number,
  resetAt: Timestamp,
}
```

Server-only. Written and read by `checkRateLimit()`.

### `processedWebhookEvents/{eventId}`

```typescript
{
  processedAt: Timestamp,
  type: string,
}
```

Server-only. Used for Stripe webhook idempotency.

### `admin/stats`

```typescript
{
  totalUsers: number,
  // Add your app-specific aggregate stats here
  lastUpdated: Timestamp,
}
```

Server-only writes. Admin-only reads.

---

## Firestore Security Rules

Rules are in `firestore.rules`. Key principles:

- `users/{uid}` is readable only by the owner (`request.auth.uid == uid`)
- Client updates are restricted to safe fields only (`preferences`, `displayName`, `company`, `updatedAt`)
- All sensitive fields (`subscription`, `role`) are server-only (`allow write: if false`)
- Subcollections follow the same ownership pattern
- `plans` is readable by any authenticated user, writable only by server
- `rateLimits`, `processedWebhookEvents`, `admin` are server-only

When adding a new subcollection, add a rule following this pattern:

```
match /users/{uid}/your-resource/{id} {
  allow read: if isOwner();
  allow delete: if isOwner();
  allow create: if false;  // server-side only
  allow update: if false;  // server-side only
}
```

---

## Plan Cache

`functions/src/plans.ts` provides a Firestore-backed plan cache with stale-while-revalidate behavior:

```typescript
import { getPlanConfig, getPlanCredits, getAllPlans, buildPriceIdToPlanMap } from "./plans";

// Get a single plan config
const config = await getPlanConfig("pro");

// Get credits for a plan
const credits = await getPlanCredits("pro");

// Build a Stripe Price ID -> plan ID map (used in webhook handler)
const map = await buildPriceIdToPlanMap();

// Invalidate cache (call after seeding)
invalidatePlanCache();
```

Cache TTL is 5 minutes. On cold start, the first call always fetches from Firestore.

---

## Rate Limiting

```typescript
// Returns null if allowed, or resetAt timestamp (ms) if rate-limited
const resetAt = await checkRateLimit(uid, "functionName", maxRequestsPerMinute);
if (resetAt !== null) {
  replyRateLimited(res, resetAt); // sends 429 with Retry-After header
  return;
}
```

The rate limiter uses Firestore transactions for consistency across function instances. On Firestore outage, it fails closed (treats as rate-limited) to protect billing-critical functions.

---

## Input Validation

All user input goes through `sanitizeString()` before use:

```typescript
import { sanitizeString } from "./validation";

const title = sanitizeString(req.body?.title, 200);
if (!title) { res.status(400).json({ error: "title is required." }); return; }
```

`sanitizeString` trims, truncates to `maxLen`, and rejects strings containing characters outside `[\p{L}\p{N}\s.,\-'&#/()_]`. Returns `null` for invalid input.

---

## Logging

```typescript
import { logger, createLogger, createRequestLogger } from "./logger";

// Module-level singleton
logger.info("message", { key: "value" });
logger.error("something failed", { error: err.message });

// Request-scoped with correlation ID from X-Request-ID header
const log = createRequestLogger("myFunction", req.headers);
log.info("handling request", { uid });

// Child logger with bound context
const log = createLogger(undefined, { function_name: "myFn", uid });
log.info("doing work");
```

Log levels: `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`.

Sensitive fields are automatically redacted:
- Keys matching `key|secret|token|password` -> `[REDACTED]`
- `uid` values -> truncated to 8 chars + `...`
- Email-shaped values -> `ab***@domain.com`

In production (Cloud Functions), logs go to `process.stdout`/`process.stderr` as JSON, which Cloud Logging parses into `jsonPayload` (filterable fields in Log Explorer).

---

## Email

```typescript
import { sendVerificationEmail, sendPasswordResetEmail, sendSupportTicketEmail } from "./emailService";

// Send verification email
await sendVerificationEmail(userEmail, verificationLink);

// Send password reset
await sendPasswordResetEmail(userEmail, resetLink);

// Send support ticket
await sendSupportTicketEmail({ ticketId, uid, userEmail, replyEmail, category, subject, message });
```

The `FROM` address is `${APP_NAME} <${EMAIL_FROM}>` from environment variables. No code changes needed when rebranding.

To add a new email type:
1. Add a template function to `emailTemplates.ts` returning an HTML string
2. Add a send function to `emailService.ts`
3. Call it from your Cloud Function

---

## TypeScript Configuration

`functions/tsconfig.json` targets ES2020 with strict mode. The compiled output goes to `functions/lib/` (gitignored).

Build before deploying:

```bash
bun run build --cwd functions
```

The Firebase CLI runs `tsc` automatically as a predeploy hook (configured in `firebase.json`).

---

## Testing

Tests use Vitest. Run with:

```bash
bun run test --cwd functions
```

Test files live alongside the source (`*.test.ts`). The test setup is in `functions/vitest.setup.ts`.

Property-based tests use `fast-check`. See `functions/src/inputValidation.test.ts` for an example.

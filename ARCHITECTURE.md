# Architecture

A technical reference for the template's infrastructure spine. Read this before adding features or modifying shared code.

---

## Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React 18, TypeScript, Vite | SPA, deployed to Firebase Hosting |
| UI | shadcn/ui (Radix) + Tailwind CSS | 50 pre-built components in `frontend/src/components/ui/` |
| State | TanStack Query + React Context | Query for server state, Context for auth/theme |
| Backend | Firebase Cloud Functions (Node 22, Gen 1) | All in `functions/src/index.ts` |
| Database | Firestore (NoSQL) | Real-time subscriptions on the frontend |
| Auth | Firebase Auth | Email/password + Google OAuth |
| Payments | Stripe | Checkout, Customer Portal, Webhooks |
| Email | Resend | Transactional only (verify, reset, MFA, support) |
| Hosting | Firebase Hosting | Two targets: `app` (SPA) and `landing` (static) |
| CI/CD | GitHub Actions | `develop` -> staging, `master` -> production |

---

## Auth Flow

```
User visits app
  -> AuthGate checks Firebase Auth state (onAuthStateChanged)
  -> No user: render <Login /> (email/password or Google OAuth)

Sign up (email/password):
  -> createUserWithEmailAndPassword
  -> Firebase triggers onUserCreate Cloud Function
     -> Sets custom claim: { role: "user" }
     -> Creates users/{uid} Firestore document
  -> User sees <VerifyEmailScreen />
  -> User clicks "Send verification email"
     -> resendVerificationEmail callable (rate-limited)
     -> Resend delivers email via sendVerificationEmailToAddress
  -> User clicks link in email -> Firebase verifies
  -> AuthContext polls emailVerified -> app unlocks

Sign up (Google):
  -> signInWithPopup
  -> Same onUserCreate trigger fires
  -> Google accounts are pre-verified, skip email gate

Subsequent logins:
  -> onAuthStateChanged fires with existing user
  -> AuthContext subscribes to users/{uid} via onSnapshot
  -> Polls for role custom claim (up to 8s, then defaults to "user")
  -> App renders once profile doc + role claim are both resolved
```

The `AuthContext` is the single source of truth for auth state. Components read from it via `useAuth()`. Never read `auth.currentUser` directly in components.

---

## Billing Flow

```
Free user clicks Upgrade:
  -> POST /api/createCheckoutSession { priceId }
  -> Function creates/reuses Stripe Customer, creates Checkout Session
  -> User redirected to Stripe Checkout
  -> On success: redirected back to /billing?session_id=...

Stripe fires checkout.session.completed webhook:
  -> POST /api/stripeWebhook
  -> Webhook verified with STRIPE_WEBHOOK_SECRET
  -> Idempotency check: processedWebhookEvents/{eventId}
  -> users/{uid}.subscription updated in Firestore
  -> Frontend onSnapshot picks up the change in real-time

Paid user upgrading/downgrading:
  -> POST /api/createPortalSession { priceId? }
  -> Opens Stripe Customer Portal (with optional upgrade flow)

Cancel:
  -> POST /api/cancelSubscription
  -> Sets cancel_at_period_end: true on Stripe subscription
  -> Firestore updated immediately

Reactivate:
  -> POST /api/reactivateSubscription
  -> Removes cancel_at_period_end

Sync on page load:
  -> AuthContext fires POST /api/syncSubscription (throttled 5 min)
  -> Reconciles Stripe state -> Firestore in case webhook was missed

Plan configs (credits, features, Stripe price IDs):
  -> Stored in Firestore `plans` collection
  -> Seeded by: bun run seed:plans
  -> Cached in-memory in functions/src/plans.ts (5 min TTL)
  -> Frontend reads via usePlans() hook
```

---

## Request Lifecycle

Every authenticated API call follows this pattern:

```
Frontend:
  1. getAuthToken() - gets Firebase ID token (auto-refreshed)
  2. fetch("/api/endpoint", { headers: { Authorization: "Bearer <token>" } })

Firebase Hosting rewrite:
  -> /api/endpoint -> Cloud Function

Cloud Function:
  1. corsHandler - validates Origin header against CORS_ORIGIN env var
  2. Method check - reject non-POST/GET with 405
  3. verifyUserRole(req) - verifies Firebase ID token, checks role claim
  4. ensureUserProfile(uid) - creates profile doc if missing (safety net)
  5. checkRateLimit(uid, fnName, maxRequests) - Firestore-backed per-user limit
  6. Input validation via sanitizeString() from validation.ts
  7. Business logic
  8. Response
```

Auth errors return 401. Rate limit returns 429 with `Retry-After` header. Validation errors return 400. Server errors return 500.

---

## Firestore Collections

```
users/{uid}
  - uid, email, displayName, photoURL, company
  - role: "user" | "admin"
  - subscription: { plan, status, creditsUsed, creditsTotal, stripeCustomerId, ... }
  - preferences: { itemsPerPage }
  - createdAt, updatedAt

  users/{uid}/items/{itemId}          <- canonical example feature
    - title, description, status, createdAt, updatedAt

  users/{uid}/notifications/{id}      <- dunning/payment alerts (server-written)

plans/{planId}                        <- plan configs, seeded by seedPlans.mjs
  - name, priceUsdCents, creditsPerMonth, stripePriceId, features, ...

rateLimits/{uid_fnName}               <- rate limit counters (server-only)
processedWebhookEvents/{eventId}      <- Stripe webhook dedup (server-only)
admin/stats                           <- aggregate platform stats (server-written)
```

All writes to `users/{uid}` from the frontend go through Firestore security rules. Sensitive fields (subscription, role) are server-only via Admin SDK.

---

## Rate Limiting

Rate limiting is Firestore-backed and per-user, so limits are consistent across all function instances (no in-memory state that resets on cold start).

Each counter lives at `rateLimits/{uid}_{fnName}` and expires after the window.

```typescript
// Usage in a Cloud Function:
const resetAt = await checkRateLimit(uid, "myAction", 10); // 10 req/min
if (resetAt !== null) { replyRateLimited(res, resetAt); return; }
```

On Firestore outage, the rate limiter fails closed (treats the request as rate-limited) to protect billing-critical functions.

---

## Logging

All backend logging uses the structured logger in `functions/src/logger.ts`. It emits single-line JSON compatible with Google Cloud Logging.

```typescript
import { logger, createLogger, createRequestLogger } from "./logger";

// Module-level logger
logger.info("message", { key: "value" });

// Request-scoped logger with correlation ID
const log = createRequestLogger("myFunction", req.headers);
log.info("handling request", { uid });

// Child logger with bound context
const log = createLogger(undefined, { function_name: "myFn" });
```

Sensitive fields are automatically redacted: keys matching `key|secret|token|password` become `[REDACTED]`, UIDs are truncated to 8 chars, emails are masked.

Frontend errors are captured by `frontend/src/lib/errorReporter.ts` and sent to `/api/report-error` (deduped within 60s).

---

## Email

All transactional email goes through Resend via `functions/src/emailService.ts`.

The `FROM` address and `APP_NAME` are read from environment variables at runtime, so no code changes are needed when rebranding.

Templates live in `functions/src/emailTemplates.ts`. They are plain HTML strings - no template engine dependency.

To add a new email type:
1. Add a function to `emailTemplates.ts` that returns an HTML string
2. Add a send function to `emailService.ts`
3. Call it from your Cloud Function

---

## Where Middleware Lives

There is no Express middleware stack. Each Cloud Function is self-contained and calls helpers in order:

```
corsHandler -> verifyUserRole/verifyAdmin -> ensureUserProfile -> checkRateLimit -> your logic
```

To add a new protected endpoint, copy this pattern from any existing function in `index.ts`.

---

## Adding a New Feature

Follow the Items feature as the reference implementation:

```
Firestore:
  users/{uid}/your-resource/{id}

Security rules (firestore.rules):
  match /users/{uid}/your-resource/{id} {
    allow read: if isOwner();
    allow create, update, delete: if false; // server-side only
  }

Cloud Function (functions/src/index.ts or a new file):
  export const yourResourceApi = functions.https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
      const decoded = await verifyUserRole(req);
      // ... CRUD logic
    });
  });

Firebase Hosting rewrite (firebase.json):
  { "source": "/api/your-resource/**", "function": "yourResourceApi" }

Frontend API helpers (frontend/src/lib/api.ts):
  export async function fetchYourResources() { ... }

Frontend hook (frontend/src/hooks/useYourResource.ts):
  // Follow useItems.ts pattern: onSnapshot + CRUD functions

Frontend page (frontend/src/pages/YourResourcePage.tsx):
  // Follow ItemsPage.tsx pattern

Route (frontend/src/App.tsx):
  <Route path="/your-resource" element={<YourResourcePage />} />

Nav item (frontend/src/components/AppSidebar.tsx):
  { title: "Your Resource", url: "/your-resource", icon: SomeIcon }
```

---

## Security Notes

- Firestore security rules enforce ownership. The frontend cannot write to `subscription`, `role`, or other sensitive fields.
- All Cloud Functions verify the Firebase ID token before doing anything.
- Admin functions use `verifyAdmin()` which also checks token revocation (`checkRevoked: true`).
- CORS is enforced via the `CORS_ORIGIN` env var. An empty value rejects all cross-origin requests.
- Input is sanitized via `sanitizeString()` before any Firestore write or external API call.
- The Stripe webhook verifies the `stripe-signature` header before processing any event.
- Webhook events are deduplicated via `processedWebhookEvents` to prevent double-processing on retries.

---

## Environment Variables

### Frontend (`frontend/.env`)

| Variable | Required | Description |
|---|---|---|
| `VITE_APP_NAME` | Yes | App name shown in UI |
| `VITE_APP_URL` | Yes | Production URL |
| `VITE_SUPPORT_EMAIL` | Yes | Support email shown in Help page |
| `VITE_FIREBASE_*` | Yes | Firebase web app config (6 vars) |
| `VITE_APP_VERSION` | No | Shown in sidebar footer |
| `VITE_BRAND_PRIMARY_COLOR` | No | Override primary color (HSL) |

### Functions (`functions/.env`)

| Variable | Required | Description |
|---|---|---|
| `APP_NAME` | Yes | Used in email subjects and bodies |
| `APP_URL` | Yes | Used in email links and Stripe redirects |
| `SUPPORT_EMAIL` | Yes | Where support tickets are sent |
| `EMAIL_FROM` | Yes | Transactional email from address |
| `CORS_ORIGIN` | Yes | Comma-separated allowed origins |
| `FRONTEND_URL` | Yes | Used for Stripe redirect URLs |
| `STRIPE_SECRET_KEY` | Yes | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Yes | Stripe webhook signing secret |
| `RESEND_API_KEY` | Yes | Resend API key |
| `BACKUP_BUCKET` | No | GCS bucket for Firestore backups |

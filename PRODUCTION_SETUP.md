# Production Environment Setup

Complete checklist for deploying FieldStack to a production Firebase project with CI/CD, backups, and all third-party services configured.

---

## Table of Contents

1. [Git & Branch Strategy](#1-git--branch-strategy)
2. [Firebase Projects](#2-firebase-projects)
3. [Google Cloud](#3-google-cloud)
4. [Stripe — Production Environment](#4-stripe--production-environment)
5. [Resend — Production Environment](#5-resend--production-environment)
6. [DataForSEO](#6-dataforseo)
7. [Environment Variables](#7-environment-variables)
8. [CI/CD Pipeline — GitHub Actions](#8-cicd-pipeline--github-actions)
9. [Custom Domain](#9-custom-domain)
10. [Database Backups](#10-database-backups)
11. [Firebase Security Hardening](#11-firebase-security-hardening)
12. [Monitoring & Observability](#12-monitoring--observability)
13. [Pre-Launch Checklist](#13-pre-launch-checklist)
14. [External Accounts Summary](#14-external-accounts-summary)

---

## 1. Git & Branch Strategy

- [ ] Create a `develop` branch from `main` — this becomes the test/staging branch
- [ ] Push current work to `develop`
- [ ] Protect `main` branch: require PR reviews, no direct pushes, require CI to pass
- [ ] Protect `develop` branch similarly (recommended)

The test project (`YOUR_DEV_PROJECT_ID`) maps to `develop`. The new prod project maps to `main`.

---

## 2. Firebase Projects

### `.firebaserc` — add the production alias

```json
{
  "projects": {
    "default": "YOUR_DEV_PROJECT_ID",
    "develop": "YOUR_DEV_PROJECT_ID",
    "production": "YOUR-PROD-PROJECT-ID"
  }
}
```

### One-time setup for the production project

- [ ] `firebase use production` then `firebase deploy --only firestore:rules,firestore:indexes`
- [ ] Enable **Email/Password** and **Google** auth providers in the Firebase Console
- [ ] Configure **authorized domains** in Firebase Auth (your prod domain; remove `localhost`)
- [ ] Set the **action URL** in Firebase Auth email templates to your prod domain
- [ ] Create a **Web App** in the prod project and copy the config values
- [ ] Enable **Firestore** in Native mode — choose `us-central1` to match functions
- [ ] Run `firebase use production && npm run seed:plans` from `functions/` to seed plan data

---

## 3. Google Cloud

These steps apply to the Google Cloud project linked to your prod Firebase project.

- [ ] Enable **Places API (New)** in Google Cloud Console
- [ ] Create a new **API key** restricted to Places API only, with HTTP referrer restrictions to your prod domain
- [ ] Create a **GCS bucket** for prod backups: `gs://YOUR-PROD-PROJECT-ID-backups`
- [ ] Set a **lifecycle rule** on the bucket to auto-delete objects older than 30 days
- [ ] Grant the prod Cloud Functions service account the following roles on the backup bucket:
  - `roles/datastore.importExportAdmin`
  - `roles/storage.admin`
- [ ] Enable **Cloud Scheduler API** in the prod project (required for scheduled functions)

---

## 4. Stripe — Production Environment

- [ ] Switch to **live mode** in the Stripe dashboard
- [ ] Create products and prices matching your test setup:
  - SoloPro monthly + annual
  - Agency monthly + annual
  - Pro monthly + annual
- [ ] Copy all 6 live `price_xxx` IDs — needed for function env vars
- [ ] Configure the **Customer Portal** (allowed plans, cancellation policy, billing address collection)
- [ ] Create a **webhook endpoint** pointing to `https://YOUR-PROD-DOMAIN/api/stripeWebhook`

  Subscribe to these events:
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
  - `customer.subscription.trial_will_end`

- [ ] Copy the live webhook **signing secret** (`whsec_...`)
- [ ] Enable **promo codes** if used
- [ ] Set up **webhook failure alerts** in Stripe Dashboard → Developers → Webhooks

---

## 5. Resend — Production Environment

- [ ] Add and **verify your sending domain** (`example.com`) in Resend
- [ ] Add the required DNS records: SPF, DKIM, DMARC
- [ ] Create a **production API key** (restrict to sending only)
- [ ] Verify the `FROM` address `noreply@example.com` is authorized under the verified domain

---

## 6. DataForSEO

- [ ] Confirm your DataForSEO account has sufficient credits/plan for production traffic
- [ ] Consider creating a separate sub-account or API key for prod vs. test to isolate billing

---

## 7. Environment Variables

### Frontend

Set these as GitHub Actions secrets — they are injected at build time via Vite.

| Variable | Description |
|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase Web SDK API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | e.g. `your-project.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | e.g. `your-project.firebasestorage.app` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID |
| `VITE_FIREBASE_APP_ID` | Firebase app ID |

### Functions

Set via Firebase Secret Manager (`firebase functions:secrets:set SECRET_NAME`) — **do not commit these to git**.

> **Recommendation:** Use [Firebase Secret Manager](https://firebase.google.com/docs/functions/config-env#secret-manager) for all sensitive values. Secrets are encrypted at rest and never appear in source control.

| Variable | Description |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` (live webhook signing secret) |
| `STRIPE_PRICE_SOLOPRO` | Live price ID |
| `STRIPE_PRICE_SOLOPRO_ANNUAL` | Live price ID |
| `STRIPE_PRICE_AGENCY` | Live price ID |
| `STRIPE_PRICE_AGENCY_ANNUAL` | Live price ID |
| `STRIPE_PRICE_PRO` | Live price ID |
| `STRIPE_PRICE_PRO_ANNUAL` | Live price ID |
| `RESEND_API_KEY` | `re_...` (prod key) |
| `FRONTEND_URL` | `https://example.com` |
| `CORS_ORIGIN` | `https://example.com,https://YOUR-PROD-PROJECT.web.app` |
| `BACKUP_BUCKET` | `gs://YOUR-PROD-PROJECT-backups` |
| `DFS_EMAIL` | DataForSEO account email |
| `DFS_PASSWORD` | DataForSEO account password |
| `GOOGLE_PLACES_API_KEY` | Prod-restricted Places API key |

---

## 8. CI/CD Pipeline — GitHub Actions

No workflows exist yet. Create two files:

- `.github/workflows/deploy-develop.yml` — triggers on push to `develop`, deploys to test project
- `.github/workflows/deploy-production.yml` — triggers on push to `main`, deploys to prod project

### GitHub Secrets to add

Go to **Settings → Secrets and variables → Actions** and add:

```
FIREBASE_TOKEN                      # from: firebase login:ci

# Test project
TEST_VITE_FIREBASE_API_KEY
TEST_VITE_FIREBASE_AUTH_DOMAIN
TEST_VITE_FIREBASE_PROJECT_ID
TEST_VITE_FIREBASE_STORAGE_BUCKET
TEST_VITE_FIREBASE_MESSAGING_SENDER_ID
TEST_VITE_FIREBASE_APP_ID

# Production project
PROD_VITE_FIREBASE_API_KEY
PROD_VITE_FIREBASE_AUTH_DOMAIN
PROD_VITE_FIREBASE_PROJECT_ID
PROD_VITE_FIREBASE_STORAGE_BUCKET
PROD_VITE_FIREBASE_MESSAGING_SENDER_ID
PROD_VITE_FIREBASE_APP_ID
```

Generate `FIREBASE_TOKEN` by running:

```bash
firebase login:ci
```

### Production workflow steps

1. Checkout code
2. Install Node 22 + deps (`npm ci` in both `frontend/` and `functions/`)
3. Run tests (`npm test` in both)
4. Build frontend with prod env vars injected
5. `firebase use production`
6. `firebase deploy --only hosting,functions,firestore` using `FIREBASE_TOKEN`

---

## 9. Custom Domain

- [ ] Add your custom domain in **Firebase Hosting** (Console → Hosting → Add custom domain)
- [ ] Update DNS records as instructed (A records or CNAME)
- [ ] Firebase provisions a free TLS cert automatically — allow up to 24 hours
- [ ] Update `FRONTEND_URL` and `CORS_ORIGIN` in functions env to the custom domain
- [ ] Update the **Content-Security-Policy** in `firebase.json`:
  - The CSP currently hardcodes `us-central1-YOUR_DEV_PROJECT_ID.cloudfunctions.net` in `connect-src`
  - Add the prod functions URL: `https://us-central1-YOUR-PROD-PROJECT.cloudfunctions.net`

---

## 10. Database Backups

The `scheduledFirestoreBackup` function already runs daily at **02:00 UTC** and exports to GCS.

- [ ] Verify the backup bucket exists and the service account has permissions (see [Section 3](#3-google-cloud))
- [ ] Set `BACKUP_BUCKET` env var to the prod bucket
- [ ] After first deploy, manually trigger a backup to confirm it works:
  ```
  POST https://YOUR-PROD-DOMAIN/api/triggerBackup
  ```
- [ ] Set a **GCS lifecycle rule** to delete backups older than 30 days (or 90 — your call)
- [ ] Enable **GCS versioning** on the backup bucket for extra safety
- [ ] Optionally configure **cross-region replication** on the bucket for disaster recovery

---

## 11. Firebase Security Hardening

- [ ] Remove `localhost` from **Firebase Auth authorized domains** in the prod project
- [ ] Enable **App Check** in Firebase Console to prevent API abuse (use reCAPTCHA v3 on the frontend)
- [ ] Set a **Firestore TTL policy** on the `jobs` collection using the `ttl` field:
  - Go to Firestore Console → TTL policies → Add policy on `jobs` collection, field `ttl`
  - The field is already indexed — the policy must be enabled manually in the console
- [ ] Enable **Firebase Alerts** for quota exceeded, billing anomalies, and function errors
- [ ] Set a **Google Cloud budget alert** on the prod project (Billing → Budgets & alerts)
- [ ] Remove or gate the `DevRateLimitTester` component so it never renders in production builds

---

## 12. Monitoring & Observability

- [ ] Enable **Firebase Performance Monitoring** (optional)
- [ ] Set up **Cloud Logging log-based alerts** for function errors:
  - Filter: `severity=ERROR` scoped to your prod project
- [ ] Enable **Uptime Checks** in Google Cloud Monitoring — ping your prod domain every 5 minutes
- [ ] Set up **Stripe webhook failure alerts** (Stripe Dashboard → Developers → Webhooks)
- [ ] Consider **Sentry** for frontend error tracking:
  - Add `VITE_SENTRY_DSN` to frontend env vars
  - Install `@sentry/react` and the Sentry Vite plugin

---

## 13. Pre-Launch Checklist

- [ ] Deploy Firestore rules and indexes to prod: `firebase use production && firebase deploy --only firestore`
- [ ] Seed plans: `firebase use production && npm run seed:plans` from `functions/`
- [ ] Full end-to-end test: sign up → verify email → search → save lead → subscribe → cancel
- [ ] Test Stripe webhook by triggering a test event from the Stripe dashboard
- [ ] Confirm the scheduled backup runs successfully
- [ ] Verify `CORS_ORIGIN` contains only the prod domain — no `localhost`
- [ ] Confirm the CSP header in `firebase.json` includes the prod functions URL
- [ ] Confirm `DevRateLimitTester` is not accessible in production
- [ ] Verify all 6 Stripe live price IDs are set and match the seeded plans in Firestore
- [ ] Confirm Resend domain is verified and a test email delivers successfully
- [ ] Check Firebase Auth authorized domains — prod domain is listed, `localhost` is removed

---

## 14. External Accounts Summary

| Service | Action Required |
|---|---|
| **Firebase** | Create prod project, configure auth providers, enable Firestore |
| **Google Cloud** | Enable Places API (New), create restricted API key, create backup bucket, set IAM permissions |
| **Stripe** | Switch to live mode, create products/prices, configure webhook endpoint and portal |
| **Resend** | Verify sending domain (SPF/DKIM/DMARC), create prod API key |
| **DataForSEO** | Confirm plan capacity, optionally create separate prod credentials |
| **GitHub** | Add all secrets, create two workflow files for develop and main branches |

---

## Common Gotchas

**CSP header** — `firebase.json` hardcodes the test project's functions URL in `connect-src`. Update it for prod or API calls will be blocked by the browser.

**`CORS_ORIGIN` must be set** — if this env var is empty, all cross-origin API requests fail with a 401. The function logs a startup error if it's missing.

**Firestore TTL policy** — the `ttl` field on `jobs` is indexed, but the TTL policy itself must be manually enabled in the Firestore Console. It won't activate from `firestore.indexes.json` alone.

**Stripe price IDs** — the `seed:plans` script reads price IDs from env vars at runtime. Run it *after* setting all `STRIPE_PRICE_*` env vars in the prod environment.

**Firebase Auth action URL** — by default, password reset and email verification links point to the Firebase-hosted action handler. Update this to your custom domain in Firebase Console → Authentication → Templates → Action URL.

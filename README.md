# Firebase SaaS Template

A production-ready SaaS starter built on Firebase. Ships with auth, billing, email, rate limiting, structured logging, and a full CI/CD pipeline. Copy it, run the initializer, and start building your product.

## What's included

**Auth**
- Email/password signup with email verification
- Google OAuth
- Custom role claims (`user` / `admin`)
- Password reset via Resend
- Account deletion (GDPR/CCPA compliant - cancels Stripe sub, deletes Firestore data)

**Billing**
- Stripe Checkout for new subscriptions
- Stripe Customer Portal for upgrades, downgrades, and payment method updates
- Webhook handler with idempotency and Firestore sync
- Cancel / reactivate flow with retention UI
- Invoice history
- Credit-based usage tracking
- Plan configs stored in Firestore (no hardcoded prices)

**Infrastructure**
- Firestore-backed rate limiting (per-user, consistent across function instances)
- Structured JSON logging compatible with Google Cloud Logging
- Frontend error reporter with deduplication
- Input sanitization on all API endpoints
- CORS enforcement via environment variable
- Support ticket submission via Resend

**Frontend**
- React 18 + TypeScript + Vite
- shadcn/ui (50 components) + Tailwind CSS
- Dark/light theme
- Collapsible sidebar with credits bar
- Settings page (profile, security, preferences)
- Billing page (plans, invoices, cancel/reactivate)
- Admin panel (stats, dev tools)
- Error boundary

**Canonical example feature**
- Full CRUD for an `Items` resource
- Real-time Firestore subscription
- Auth-gated Cloud Function API
- Demonstrates the full stack pattern to copy for your own features

**DevOps**
- GitHub Actions CI/CD (develop -> staging, master -> production)
- Workload Identity Federation (no long-lived service account keys in CI)
- Firebase Hosting with security headers (CSP, HSTS, X-Frame-Options)
- Vitest test suite (191 tests)

---

## Stack

| | |
|---|---|
| Frontend | React 18, TypeScript, Vite |
| UI | shadcn/ui + Tailwind CSS |
| Backend | Firebase Cloud Functions (Node 22) |
| Database | Firestore |
| Auth | Firebase Auth |
| Payments | Stripe |
| Email | Resend |
| Hosting | Firebase Hosting |
| CI/CD | GitHub Actions |
| Tests | Vitest |

---

## Getting started

See [QUICKSTART.md](QUICKSTART.md) for the full setup guide.

The short version:

```bash
# 1. Initialize the project (replaces all TEMPLATE_APP placeholders)
npx ts-node scripts/init-project.ts

# 2. Install dependencies
npm install && npm install --prefix frontend && npm install --prefix functions

# 3. Build and start everything (frontend + functions + Firebase emulators)
npm run dev
```

> **How local dev works:** The Firebase Hosting emulator (port 5002) serves the
> pre-built `frontend/dist/` folder — it does **not** use the Vite dev server.
> `npm run dev` builds both the frontend and functions first, then starts all
> emulators. Re-run it whenever you make code changes, or run
> `npm run build:frontend` / `npm run build:functions` individually and let the
> emulators pick up the new files.

| Service | URL |
|---|---|
| App (Firebase Hosting) | http://localhost:5002 |
| Emulator UI | http://localhost:4000 |
| Functions | http://localhost:5001 |
| Firestore | http://localhost:8080 |
| Auth | http://localhost:9099 |

---

## Project structure

```
.
├── frontend/               React SPA
│   ├── src/
│   │   ├── components/     UI components (ui/ = shadcn, rest = app-specific)
│   │   ├── contexts/       AuthContext, ThemeContext
│   │   ├── hooks/          useCredits, usePlans, useItems, usePreferences
│   │   ├── lib/            firebase.ts, api.ts, config.ts, errorReporter.ts
│   │   └── pages/          ItemsPage, Billing, Settings, Help, SystemAdmin
│   └── public/             Static assets (replace logo files here)
│
├── functions/              Firebase Cloud Functions
│   ├── src/
│   │   ├── index.ts        All Cloud Functions (auth, billing, items API, admin)
│   │   ├── types.ts        Shared TypeScript types
│   │   ├── plans.ts        Firestore-backed plan cache
│   │   ├── seedPlans.ts    Plan seed data
│   │   ├── emailService.ts Resend wrapper
│   │   ├── emailTemplates.ts HTML email templates
│   │   ├── logger.ts       Structured JSON logger
│   │   ├── validation.ts   Input sanitization
│   │   └── authHelpers.ts  Role check utilities
│   └── scripts/
│       ├── seedPlans.mjs   Seed plans to Firestore
│       └── bootstrap-admin.ts  Grant admin role to a user
│
├── landing-site/           Static marketing/landing page
│   └── public/             Pure HTML/CSS - no build step
│
├── email-templates/        Standalone HTML email previews (reference only)
├── firestore.rules         Firestore security rules
├── firestore.indexes.json  Composite indexes
├── firebase.json           Firebase project config
├── .firebaserc             Project aliases
├── scripts/
│   └── init-project.ts     Project initializer
├── QUICKSTART.md           Setup guide
└── ARCHITECTURE.md         Technical reference
```

---

## Adding a feature

The `Items` feature is the reference implementation. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full pattern.

Short version: add a Firestore subcollection, a Cloud Function, a rewrite in `firebase.json`, API helpers in `api.ts`, a real-time hook, and a page.

---

## Rebranding

Run `scripts/init-project.ts` - it handles most replacements automatically. Then:

1. Replace logo files in `frontend/public/` and `landing-site/public/`
2. Update `frontend/src/lib/config.ts` for brand colors
3. Update `landing-site/public/index.html` with your product copy

---

## Tests

```bash
bun run test --cwd frontend    # 50 tests
bun run test --cwd functions   # 141 tests
```

---

## Deploy

```bash
firebase deploy --project your-project-id
```

Or push to `master` to trigger the GitHub Actions production deploy. See [QUICKSTART.md](QUICKSTART.md) for the required GitHub Secrets.

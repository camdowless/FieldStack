# Quickstart Guide

Get from zero to a running app in about 10 minutes.

## Prerequisites

- [Node.js 22+](https://nodejs.org)
- [Bun](https://bun.sh) (`npm install -g bun`)
- [Firebase CLI](https://firebase.google.com/docs/cli) (`npm install -g firebase-tools`)
- A [Firebase project](https://console.firebase.google.com) (free Spark plan works for dev)
- A [Stripe account](https://stripe.com) (test mode is fine)
- A [Resend account](https://resend.com) for transactional email

---

## Step 1: Initialize the project

Run the interactive initializer. It replaces all `FieldStack` placeholders with your project details.

```bash
npx ts-node scripts/init-project.ts
```

If you don't have `ts-node`, install it first:

```bash
npm install -g ts-node typescript
```

The script will:
- Ask for your app name, URL, support email, and Firebase project IDs
- Replace all placeholders across the codebase
- Generate `frontend/.env` and `functions/.env` with your values
- Optionally reset git history to a clean first commit

---

## Step 2: Firebase setup

### Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Create a new project
3. Enable **Firestore** (Native mode)
4. Enable **Authentication** - turn on Email/Password and Google providers
5. Create a **Web App** and copy the config values

### Fill in Firebase config

Open `frontend/.env` and paste your Firebase web app config:

```env
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123
```

### Configure Firebase CLI

```bash
firebase login
firebase use your-project-id
```

---

## Step 3: Stripe setup

1. Go to [dashboard.stripe.com](https://dashboard.stripe.com)
2. Copy your **test secret key** (`sk_test_...`) into `functions/.env`
3. Create products and prices for each plan (Pro, Agency, Enterprise)
4. Copy the Price IDs into `functions/.env`

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_PRO_ANNUAL=price_...
# etc.
```

For local webhook testing, install the [Stripe CLI](https://stripe.com/docs/stripe-cli) and run:

```bash
stripe listen --forward-to localhost:5001/your-project-id/us-central1/stripeWebhook
```

Copy the webhook signing secret it prints into `functions/.env`:

```env
STRIPE_WEBHOOK_SECRET=whsec_...
```

---

## Step 4: Resend setup

1. Go to [resend.com](https://resend.com) and create an account
2. Add and verify your sending domain
3. Create an API key and add it to `functions/.env`:

```env
RESEND_API_KEY=re_...
EMAIL_FROM=noreply@yourdomain.com
```

---

## Step 5: Install dependencies

```bash
bun install
bun install --cwd frontend
bun install --cwd functions
```

---

## Step 6: Seed plans

Write the plan configs (with your Stripe Price IDs) to Firestore:

```bash
bun run seed:plans:emulator   # against local emulator
# or
bun run seed:plans            # against your Firebase project
```

---

## Step 7: Run locally

Start the Firebase emulators:

```bash
firebase emulators:start
```

In a separate terminal, start the frontend dev server:

```bash
bun run dev --cwd frontend
```

Open [http://localhost:5173](http://localhost:5173). Sign up for an account and verify it works.

---

## Step 8: Bootstrap an admin user

After signing up with your first account, run the bootstrap script to give yourself the admin role:

```bash
npx ts-node functions/scripts/bootstrap-admin.ts your@email.com
```

Then sign out and back in to pick up the new role claim.

---

## Step 9: Deploy

### First deploy

```bash
firebase deploy --project your-project-id
```

This deploys hosting, functions, and Firestore rules all at once.

### Subsequent deploys

Push to `master` to trigger the GitHub Actions production deploy, or `develop` for the staging deploy.

Set these GitHub Secrets in your repo settings before the first CI deploy:

| Secret | Where to find it |
|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase Console - Web App config |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Console - Web App config |
| `VITE_FIREBASE_PROJECT_ID` | Firebase Console - Web App config |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase Console - Web App config |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase Console - Web App config |
| `VITE_FIREBASE_APP_ID` | Firebase Console - Web App config |
| `VITE_APP_NAME` | Your app name |
| `VITE_APP_URL` | Your production URL |
| `VITE_SUPPORT_EMAIL` | Your support email |
| `EMAIL_FROM` | Your transactional email from address |
| `STRIPE_SECRET_KEY` | Stripe Dashboard - API Keys |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard - Webhooks |
| `RESEND_API_KEY` | Resend Dashboard - API Keys |
| `PROD_WIF_PROVIDER` | Google Cloud - Workload Identity Federation |
| `PROD_WIF_SERVICE_ACCOUNT` | Google Cloud - Service Account |

See [PRODUCTION_SETUP.md](PRODUCTION_SETUP.md) for the full Workload Identity Federation setup.

---

## How to add a new feature

The `Items` feature in `frontend/src/pages/ItemsPage.tsx` and `functions/src/index.ts` is the canonical example. Follow this pattern:

1. **Define the Firestore path** - `users/{uid}/your-resource/{id}`
2. **Add Firestore rules** in `firestore.rules`
3. **Add a Cloud Function** in `functions/src/index.ts` (or a new file, imported there)
4. **Add a rewrite** in `firebase.json` pointing to your function
5. **Add API helpers** in `frontend/src/lib/api.ts`
6. **Add a real-time hook** following the pattern in `frontend/src/hooks/useItems.ts`
7. **Add a page** following `frontend/src/pages/ItemsPage.tsx`
8. **Add a route** in `frontend/src/App.tsx`
9. **Add a nav item** in `frontend/src/components/AppSidebar.tsx`

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full request lifecycle and design decisions.

---

## How to rebrand

1. Run `scripts/init-project.ts` - it handles most replacements automatically
2. Replace logo files in `frontend/public/` and `landing-site/public/` with your own SVGs
3. Update `frontend/src/lib/config.ts` for any brand colors
4. Update `landing-site/public/index.html` with your product copy
5. Update email templates in `functions/src/emailTemplates.ts` if you want custom styling

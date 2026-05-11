# FieldStack

Construction schedule intelligence — parse schedules, track order timelines, and get alerts before installs slip.

## Stack

- **Frontend**: React + Vite + TypeScript + TailwindCSS + shadcn/ui
- **Backend**: Firebase Cloud Functions (Node 22, TypeScript)
- **Database**: Firestore
- **Auth**: Firebase Authentication (email/password + Google OAuth)
- **Storage**: Firebase Storage (schedule file uploads)
- **Billing**: Stripe
- **AI**: Claude (Anthropic) for schedule parsing

## Local Development

### Prerequisites

- Node.js 22+
- Firebase CLI: `npm install -g firebase-tools`
- Firebase project with Auth, Firestore, and Storage enabled

### Setup

```bash
# Install frontend dependencies
cd frontend && npm install

# Install functions dependencies
cd ../functions && npm install
```

Create `frontend/.env.local` with your Firebase config:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

Create `functions/.env` with your API keys:

```
ANTHROPIC_API_KEY=...
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
CORS_ORIGIN=http://localhost:5173
```

### Run Locally

```bash
# Terminal 1 — frontend dev server
cd frontend && npm run dev

# Terminal 2 — Firebase emulators (auth, firestore, functions)
firebase emulators:start --only auth,firestore,functions
```

Frontend: http://localhost:5173  
Emulator UI: http://localhost:4000

### Deploy

```bash
# Build and deploy everything
firebase deploy

# Deploy only functions
firebase deploy --only functions

# Deploy only hosting
cd frontend && npm run build && firebase deploy --only hosting
```

## Project Structure

```
FieldStack/
├── frontend/          # React SPA
│   └── src/
│       ├── components/
│       │   └── project/   # Project detail tabs
│       ├── hooks/         # TanStack Query + Firestore listeners
│       ├── lib/           # Firebase init, API client
│       └── pages/
├── functions/         # Cloud Functions
│   └── src/
│       └── fieldstack/    # Domain functions (projects, parser, alerts, orders)
├── firestore.rules
├── firestore.indexes.json
└── firebase.json
```

## Features (Phase 1)

- **Company onboarding** — provision a company on first sign-up
- **Projects** — create and manage construction projects
- **Schedule upload** — upload PDF, XLSX, CSV, or TXT schedules; Claude parses tasks and order items
- **Orders** — track order status (NOT_ORDERED → ORDERED → IN_TRANSIT → DELIVERED)
- **Alerts** — CRITICAL/WARNING/INFO alerts based on order-by dates vs install dates
- **Changes** — detect and log schedule date shifts between uploads
- **Feed** — activity log per project

## Phase 2 (Planned)

AI chat assistant, Gmail integration, Procore sync, team management, escalation workflows, magic links.

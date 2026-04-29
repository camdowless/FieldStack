# FieldStack — Schedule Intelligence Platform

Cabinet & countertop subcontractor schedule tracking. Parses GC lookahead schedules, computes order-by dates, and fires email alerts when dates shift or deadlines approach.

---

## What It Does

- **Upload any schedule** — PDF, XLSX, or plain text. Claude AI extracts all tasks automatically.
- **Tracks your tasks only** — filters cabinet delivery and countertop set tasks across all buildings and floors.
- **Computes order-by dates** — works backward from install dates using your configured lead times (4–16 weeks).
- **Detects schedule shifts** — compares each new upload against the previous version, flags what moved and by how many days.
- **Emails your team** — critical alerts fire immediately; warnings go in a daily digest; schedule changes notify instantly on upload.
- **Order tracker** — update PO numbers, status, and notes inline per order item.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Database | PostgreSQL via Prisma ORM |
| DB Host | Supabase (free tier) |
| AI Parser | Anthropic Claude API |
| Email | Resend |
| Deployment | Vercel |
| Styling | Tailwind CSS + CSS variables |

---

## Prerequisites — Create These Accounts First

| Service | URL | What to grab | Time |
|---------|-----|-------------|------|
| Supabase | supabase.com | New project → Settings → Database → Connection string | 5 min |
| Anthropic | console.anthropic.com | API Keys → Create key | 2 min |
| Resend | resend.com | Add your domain → API Keys → Create key | 10 min |
| Vercel | vercel.com | Connect GitHub | 3 min |
| GitHub | github.com | Create empty repo | 2 min |

---

## Local Development

### 1. Install dependencies
```bash
npm install
```

### 2. Set up environment variables
```bash
cp .env.example .env.local
```

Fill in `.env.local`:
```
DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres"
ANTHROPIC_API_KEY="sk-ant-..."
RESEND_API_KEY="re_..."
RESEND_FROM_EMAIL="alerts@yourcompany.com"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
CRON_SECRET="any-random-string"
```

### 3. Push database schema
```bash
npm run db:push
```

### 4. Seed default lead times
```bash
npm run db:seed
```

### 5. Run dev server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Deploy to Vercel

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "Initial FieldStack build"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/fieldstack.git
git push -u origin main
```

### 2. Deploy on Vercel
1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your GitHub repo
3. Add all environment variables from `.env.local` (change `NEXT_PUBLIC_APP_URL` to your Vercel URL)
4. Deploy

### 3. Run migrations on production DB
```bash
# Pull production env vars locally
vercel env pull .env.production.local

# Push schema to production DB
npx dotenv -e .env.production.local -- npx prisma db push

# Seed production DB
npx dotenv -e .env.production.local -- npx tsx prisma/seed.ts
```

---

## Daily Alert Cron

`vercel.json` configures a daily cron at 7am UTC (runs `POST /api/alerts/evaluate`).

To test locally:
```bash
curl -X POST http://localhost:3000/api/alerts/evaluate \
  -H "x-cron-secret: your-cron-secret"
```

---

## First Use Walkthrough

1. Go to `/dashboard` → click **New Project**
2. Fill in project name, address, GC name
3. Open the project → go to **Upload** tab
4. Drop in the Lexington PDF (or any GC lookahead PDF)
5. Watch the AI parse it — tasks and order items appear in seconds
6. Go to **Overview** tab to see alerts
7. Go to **Orders** tab to update PO numbers and status
8. Go to `/team` to add your field supervisor and purchasing contact

---

## File Structure

```
fieldstack/
├── prisma/
│   ├── schema.prisma          # Full database schema
│   └── seed.ts                # Seeds lead time defaults
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── projects/      # GET/POST projects
│   │   │   │   └── [id]/
│   │   │   │       ├── alerts/    # Computed alert list
│   │   │   │       ├── tasks/     # Tasks for project
│   │   │   │       └── changes/   # Schedule diff log
│   │   │   ├── schedules/
│   │   │   │   └── upload/    # PDF upload + Claude parser
│   │   │   ├── orders/
│   │   │   │   └── [id]/      # PATCH order status/PO
│   │   │   ├── alerts/
│   │   │   │   └── evaluate/  # Cron alert engine
│   │   │   ├── team/          # Team CRUD
│   │   │   └── settings/
│   │   │       └── lead-times/ # Lead time defaults
│   │   ├── dashboard/         # Project list dashboard
│   │   │   └── new/           # New project form
│   │   ├── projects/
│   │   │   └── [id]/          # Project detail (all tabs)
│   │   ├── settings/          # Global settings page
│   │   └── team/              # Team management page
│   ├── components/
│   │   ├── AppShell.tsx       # Layout: topbar + sidebar
│   │   └── ui/index.tsx       # Badge, Button, Card, Modal, Toggle...
│   └── lib/
│       ├── prisma.ts          # DB client singleton
│       ├── alerts.ts          # Alert level computation
│       ├── parser.ts          # Claude API schedule parser
│       └── email.ts           # Resend email notifications
├── .env.example
├── vercel.json                # Cron job config
└── README.md
```

---

## Adding a New GC Platform

When a GC uses Procore or Buildertrend, they can still export a PDF lookahead — upload it the same way. For automated polling (Phase 2), add a `gcPlatform` field to the Project model and a polling job that hits the Procore/Buildertrend API on a schedule.

---

## Environment Variables Reference

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Supabase PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | Claude API key from console.anthropic.com |
| `RESEND_API_KEY` | Resend transactional email API key |
| `RESEND_FROM_EMAIL` | From address (must be verified domain in Resend) |
| `NEXT_PUBLIC_APP_URL` | Your deployment URL (no trailing slash) |
| `CRON_SECRET` | Random string to authenticate cron endpoint |

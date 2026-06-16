# PALLARES Sales CRM

Deployed Next.js app for sales reps — magic-link auth, full read parity with the operator dashboard, CRM-only writes.

## Setup

```bash
cd sales-app
cp ../.env.example .env.local   # or create manually
```

Required in `sales-app/.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_DB_URL=postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres
PROJECT_ROOT=..
```

`SUPABASE_DB_URL` is server-only (API routes) — same direct Postgres connection as the operator dashboard. Never expose it as `NEXT_PUBLIC_*` on Vercel.

`PROJECT_ROOT` points at the repo root so `/api/config` can read `config/*.yaml`.

## Dev

```bash
npm install
npm run dev
```

Open http://localhost:3000 — unauthenticated users redirect to `/login`.

## Auth

- Signups disabled in Supabase; reps must be invited first.
- Invite: `python scripts/invite_user.py rep@example.com` (from repo root with `.env` loaded).
- Login: magic link on `/sign-in`.

## Deploy (Vercel)

```bash
vercel link    # project: pallares-sales
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SUPABASE_DB_URL
vercel deploy --prod
```

Add the Vercel production + preview URLs to Supabase Auth → URL configuration.

## Access model

| Surface | Reads | Writes |
|---------|-------|--------|
| Sales app (anon + JWT, RLS) | All leads, runs, costs, vendors | `sales_feedback` only |
| Operator dashboard (direct Postgres) | Everything | CRM + spawns CLI jobs |

Pipeline triggers (runs, requests, doctor) are **not** in the sales app.

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
PROJECT_ROOT=..
```

Optional for local dev (direct Postgres — faster, same as operator dashboard):

```
SUPABASE_DB_URL=postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres
```

On **Vercel**, reads use the authenticated Supabase client (HTTPS + RLS). Do **not** set `SUPABASE_DB_URL` on Vercel — direct `db.*` hostnames are IPv6-only and fail from serverless.

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

The Vercel project **`pallares-sales`** must use **Root Directory = `sales-app`** (not the repo root). GitHub pushes to `main` auto-deploy that project only — do not connect a second Vercel project to this monorepo root.

```bash
cd ..   # repo root
vercel link --yes --project pallares-sales
python scripts/sync_sales_vercel_env.py   # NEXT_PUBLIC_SUPABASE_* + PROJECT_ROOT
vercel deploy --prod
```

Run `vercel` from the **repo root** when the project root directory is `sales-app`. Deploying from inside `sales-app/` doubles the path and fails.

Add the Vercel production + preview URLs to Supabase Auth → URL configuration.

## Access model

| Surface | Reads | Writes |
|---------|-------|--------|
| Sales app (anon + JWT, RLS) | All leads, runs, costs, vendors | `sales_feedback` only |
| Operator dashboard (direct Postgres) | Everything | CRM + spawns CLI jobs |

Pipeline triggers (runs, requests, doctor) are **not** in the sales app.

# Pallares Developer Console (`sales-app`)

Deployed Next.js **Developer Console** for pipeline operations — job queue, runs,
costs, partner API docs, and live Realtime monitoring. **Not** the primary CRM;
use local `dashboard/` for CRM (`/crm`, `/leads`, `/triage`).

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

Optional for local dev (direct Postgres — faster reads, same as operator dashboard):

```
SUPABASE_DB_URL=postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres
```

Admin partner-key routes (create/revoke) also need:

```
SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

Set `app_metadata.is_admin = true` on admin users in Supabase Auth.

On **Vercel**, reads use the authenticated Supabase client (HTTPS + RLS). Do **not**
set `SUPABASE_DB_URL` on Vercel — direct `db.*` hostnames are IPv6-only and fail
from serverless. Set `SUPABASE_SERVICE_ROLE_KEY` only as a **server** env var on
Vercel (never expose to the browser).

`PROJECT_ROOT` points at the repo root so `/api/config` can read `config/*.yaml`.

## Dev

```bash
npm install
npm run dev
```

Open http://localhost:3000 — unauthenticated users redirect to `/login`.

## Auth

- Signups disabled in Supabase; users must be invited first.
- Invite: `python scripts/invite_user.py rep@example.com` (from repo root with `.env` loaded).
- Login: magic link on `/sign-in`.

## Deploy (Vercel)

The Vercel project **`pallares-sales`** must use **Root Directory = `sales-app`**.

```bash
cd ..   # repo root
vercel link --yes --project pallares-sales
python scripts/sync_sales_vercel_env.py   # NEXT_PUBLIC_SUPABASE_* + PROJECT_ROOT
vercel deploy --prod
```

Add the Vercel production + preview URLs to Supabase Auth → URL configuration.

## Console surfaces

| Route | Purpose |
|-------|---------|
| `/jobs` | Enqueue CLI jobs (`run`, `run-campaign`, `doctor`, …) via pgmq |
| `/runs` | Run history + live modal (Supabase Realtime on `run_events` / `cost_events`) |
| `/costs` | Provider spend and credit snapshots |
| `/partner-api` | OpenAPI link, eligibility docs, admin key management |
| `/` (overview) | Queue depth, worker heartbeats, live credit-burn widget |

Live run modals subscribe to `run_events` and `cost_events` through
`lib/use-run-stream.ts`. Queue observability uses `GET /api/queue`
(pgmq metrics + `worker_status` heartbeats).

## Access model

| Surface | Reads | Writes |
|---------|-------|--------|
| Developer Console (anon + JWT, RLS) | All leads, runs, costs, vendors | `sales_feedback` only; admins manage partner keys |
| Operator dashboard (direct Postgres) | Everything | CRM + spawns local CLI jobs |

Pipeline triggers from Vercel enqueue into Supabase pgmq; a local or hosted
`pallares-leads worker` process executes them.

# PALLARES Leads Dashboard

Local operator dashboard for the `pallares-leads` pipeline. Reads **Supabase Postgres** via `postgres` npm and spawns CLI jobs for runs, requests, and health checks.

## Prerequisites

- Node.js 20+
- Python venv with `pallares-leads` installed at the repo root (`pip install -e .`)
- Supabase project with migrations applied (`supabase db push`)

## Setup

```powershell
cd dashboard
npm install
```

Create `dashboard/.env.local`:

```
SUPABASE_DB_URL=postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres
PROJECT_ROOT=..
```

Copy `SUPABASE_DB_URL` from the repo-root `.env`.

## Development

```powershell
npm run dev
```

Open **https://pallares.localhost** (Portless) or `npm run dev:direct` on port 3000.

This dashboard is the only in-repo app surface. It is a developer/operator/observer console for launching runs, monitoring providers and costs, inspecting evidence, and recording learning feedback. It is not a CRM; paying integrations use the Partner API.

## API

- `POST /api/jobs/run`, `/api/jobs/request`, `/api/jobs/doctor`
- `GET /api/jobs/[id]/stream` — Server-Sent Events log stream
- `GET /api/leads`, `/api/runs`, `/api/costs`, etc. — Postgres-backed

The dashboard spawns `pallares-leads` from `.venv/Scripts/` when present.

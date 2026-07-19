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

```bash
npm run dev
```

Opens **http://127.0.0.1:3000** (Turbopack). This is the Safari-stable path.

### Optional: named Portless URL

```bash
npm run dev:portless
```

→ **https://pallares.localhost** (port 3456). HMR WebSockets often fail over Portless HTTPS; a small head script blocks JS `location.reload()` loops so the page stays interactive (live HMR may still be dead). For full HMR, prefer `npm run dev` + `http://127.0.0.1:3000`. After upgrading portless, restart the system proxy once (sudo):

```bash
npx portless proxy stop && npx portless proxy start
npx portless hosts sync
```


This dashboard is the only in-repo app surface. It is a developer/operator/observer console for launching runs, monitoring providers and costs, inspecting evidence, and recording learning feedback. It is not a CRM; paying integrations use the Partner API.

## API

- `POST /api/jobs/run`, `/api/jobs/request`, `/api/jobs/doctor`
- `GET /api/jobs/[id]/stream` — Server-Sent Events log stream
- `GET /api/leads`, `/api/runs`, `/api/costs`, etc. — Postgres-backed

The dashboard spawns `pallares-leads` from `.venv/Scripts/` when present.

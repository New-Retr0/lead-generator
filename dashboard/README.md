# PALLARES Leads Dashboard

Local Next.js dashboard for the `pallares-leads` pipeline. Reads `data/pallares.db` via better-sqlite3 and spawns CLI jobs for runs, requests, and Sheets export.

## Prerequisites

- Node.js 20+
- Python venv with `pallares-leads` installed at the repo root (`pip install -e .`)
- SQLite database at `data/pallares.db` (created by running the pipeline)

## Setup

```powershell
cd dashboard
npm install
```

Copy or verify `.env.local`:

```
PALLARES_DB_PATH=../data/pallares.db
PROJECT_ROOT=..
```

## Development

```powershell
npm run dev
```

Open **https://pallares.localhost** (via [Portless](https://portless.sh) — stable local URL, no port juggling).

First run on Windows may prompt to trust the local HTTPS certificate:

```powershell
npx portless trust
```

Bypass Portless and use plain Next.js on port 3000:

```powershell
npm run dev:direct
# or: $env:PORTLESS=0; npm run dev
```

Open [http://localhost:3000](http://localhost:3000) when using `dev:direct`.

## Pages

| Route | Description |
|-------|-------------|
| `/` | KPI overview — leads, ready-to-call rate, monthly credits/USD |
| `/leads` | Filterable lead table, row select, export to Sheets |
| `/requests` | NL lead requests (dry-run or full run) |
| `/runs` | Run history, start new runs, SSE job logs |
| `/costs` | Cost charts from `cost_events` |
| `/duds` | Low-score / needs_manual triage |

## API routes

- `GET /api/overview`, `/api/leads`, `/api/costs`, `/api/runs`, `/api/requests`
- `POST /api/jobs/run`, `/api/jobs/request`, `/api/export/sheets`
- `GET /api/jobs/[id]/stream` — Server-Sent Events log stream

## Notes

- The dashboard spawns `pallares-leads` from `.venv/Scripts/` when present.
- Sheets export requires Google credentials in the parent project `.env`.
- DB is opened read-only; writes happen via spawned CLI processes.

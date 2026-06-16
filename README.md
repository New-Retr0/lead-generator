# PALLARES Lead Generator

Repeatable commercial property lead runs for **PALLARES** exterior cleaning brokerage. Each place is **discovered and enriched in one pass** — there is no separate enrichment pipeline or re-enrich CLI.

**Stack (per place, single pass):** Google Places / Overpass → Firecrawl → Browser Use Cloud (owner chain) → AI Gateway (sales copy) → **Supabase Postgres**.

Canonical data lives in **Supabase** (`pallares-leads` project). Re-runs skip known leads; `page_cache` / `domain_cache` stay in local `data/local_cache.db` to save DB space.

## Setup

```powershell
cd "C:\Users\Austi\Documents\Projects\lead-generator"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev,ownerchain]"
copy .env.example .env
# Fill in .env — SUPABASE_URL, SUPABASE_DB_URL, API keys
supabase link   # once
supabase db push
```

Optional owner-chain tier:

```powershell
# .env
BROWSER_USE_API_KEY=bu_...
BROWSER_USE_ENABLED=true
pallares-leads warm-portals --county fresno_ca
```

### Google Cloud

Full walkthrough: **[docs/GOOGLE-PLACES-SETUP.md](docs/GOOGLE-PLACES-SETUP.md)**

## Usage

```powershell
# Single-pass run for one market + category (discover + enrich together)
pallares-leads run --market reedley --category strip_mall

# Natural-language lead request (DB-first, then single-pass gap fill)
pallares-leads request "5 strip mall leads in reedley" --dry-run
pallares-leads request "3 leads in reedley along CA-99" --yes

# Smoke sample, campaign, discover-only (no per-place processing)
pallares-leads smoke-sample
pallares-leads run-campaign --limit 20

# DB + cost observability
pallares-leads db status
pallares-leads db report <run_id>
pallares-leads db prune --keep-days 30

# Eval replay (heuristic scores, stage traces)
pallares-leads eval-replay --from-jsonl data/raw --db-only

pallares-leads list
pallares-leads doctor
```

## Local dashboard

```powershell
cd dashboard
npm install
npm run dev
```

Open **https://pallares.localhost** — overview KPIs, lead table with verification levels, natural-language requests, live run timeline (JSON progress), cost charts, triage at `/triage`.

Uses [Portless](https://portless.sh) for a stable `.localhost` URL instead of `localhost:3000`. First run on Windows: `npx portless trust` if the browser warns about HTTPS. To skip Portless: `npm run dev:direct` → http://localhost:3000.

Dashboard nav: **Pipeline** (overview, requests, runs) vs **Sales** (CRM, leads, triage) vs **Operations** (costs). Runs are single-pass — each place is discovered and processed together.

## Per-place processing tiers

These run automatically inside a single `run` — not as a separate enrichment step:

1. **Profile fast path** (0 cr) — franchise playbooks with trusted Google phone
2. **Map + scrape+JSON** (~5 cr) — structured contact extraction from website
3. **Search gap-fill** (~6 cr) — when contact bar not met
4. **Leasing/PDF** (~1–5 cr) — multi-tenant properties
5. **Owner chain** (Browser Use) — SOS bizfile, recorder index, parcel portal, LoopNet when `allow_owner_chain: true`
6. **AI Gateway** — Why Call + talking points (token-tracked in `cost_events`)

Firecrawl Agent tier was removed (never fired in production; owner chain replaces it).

**BBB registry** (~3 cr) runs when no verified person exists yet (`registry_lookup: bbb` in `categories.yaml`).

## Verification (no guessing)

- Every contact fact is atomic with `source_url`, `verification`, and optional `quote`.
- Firecrawl JSON is grounded against page markdown; placeholder names (e.g. "John Doe") are rejected.
- Lead `verification_level`: **verified** (callable phone + verified person), **partial** (phone only), **unverified**.
- Structured CLI progress: set `PALLARES_LOG_JSON=1` (dashboard does this automatically).

## Project layout

```
config/              markets, categories, campaign, jurisdictions, pricing, search_templates
src/pallares_leads/
  discover/          Places, Overpass, mgmt directory harvest
  enrich/            Firecrawl, owner chain, Browser Use, sales copy
  request/           NL planner + deterministic fulfiller
  resolve/           contact hierarchy, confidence, lead_score
  pipeline/          run orchestration (single-pass discover + enrich), CSV/Sheets export
  db/                SQLite ledger + cost_events + page_cache
  eval/              stage-traced eval replay
dashboard/           Next.js + shadcn control plane
data/
  pallares.db        canonical lead state
  runs/{run_id}/     manifest.json, raw jsonl, export.csv per run
  exports/           request deliverables
  evals/             eval replay reports
```

Per-category rules (`min_contact_bar`, `allow_owner_chain`, etc.) live in `config/categories.yaml`.

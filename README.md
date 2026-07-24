# PALLARES Lead Generator

Repeatable commercial property lead runs for **PALLARES** exterior cleaning brokerage. Each place is **discovered and enriched in one pass** — there is no separate enrichment pipeline or re-enrich CLI.

**Stack (per place, single pass):** Google Places / Overpass → Firecrawl map/scrape/search → grounded contact extraction → public registries / owner chain → **Supabase Postgres**.

Canonical data lives in **Supabase** (`pallares-leads` project). Re-runs skip known leads; `page_cache` / `domain_cache` stay in local `data/local_cache.db` to save DB space.

## Setup

```powershell
cd "C:\Users\Austi\Documents\Projects\lead-generator"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
copy .env.example .env
# Fill in .env — see .env.example (Places, Firecrawl, Supabase)
supabase link   # once
supabase db push
```

Docs index: **[docs/README.md](docs/README.md)** (Partner OpenAPI, yield proof pack, Places setup).

Owner-chain escalations use the Firecrawl agent (`FIRECRAWL_API_KEY` required) for SOS / recorder / parcel portals when `allow_owner_chain: true`.

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
npm --prefix dashboard install
npm run dev
```

Open **https://pallares.localhost** — Command Center, campaigns and lead requests, verified-DM inventory, live run timelines, Pipeline Studio, cost analytics, learning feedback, and configuration.

Uses [Portless](https://portless.sh) for a stable `.localhost` URL instead of `localhost:3000`. First run on Windows: `npm --prefix dashboard exec portless trust` if the browser warns about HTTPS. To skip Portless: `npm run dev:direct` → http://localhost:3000.

The dashboard is a local developer/operator console, not a CRM. The sellable product surface is the scoped Partner API under `/v1/`. Runs are single-pass — each place is discovered and processed together.

## Per-place processing tiers

These run automatically inside a single `run` — not as a separate enrichment step:

1. **Profile fast path** (0 cr) — franchise playbooks with trusted Google phone
2. **Map + scrape + grounded extract** — structured contact extraction from website evidence
3. **Search gap-fill** (~6 cr) — when contact bar not met
4. **Leasing/PDF** (~1–5 cr) — multi-tenant properties
5. **Capped Firecrawl Agent** — hard contact gaps before owner-chain escalation
6. **Owner chain** — Firecrawl agent for SOS, recorder index, parcel, and related public-record evidence when `allow_owner_chain: true`
7. **Ready gate** — verified named decision-maker + local callable phone

**BBB registry** (~3 cr) runs when no verified person exists yet (`registry_lookup: bbb` in `categories.yaml`).

## Verification (no guessing)

- Every contact fact is atomic with `source_url`, `verification`, and optional `quote`.
- Firecrawl JSON is grounded against page markdown; placeholder names (e.g. "John Doe") are rejected.
- Lead `verification_level`: **verified** (callable phone + verified person), **partial** (phone only), **unverified**.
- Structured CLI progress: set `PALLARES_LOG_JSON=1` (dashboard does this automatically).

## Project layout

```
config/              markets, categories, campaign, jurisdictions, licensing, pricing, search_templates, decision_roles
src/pallares_leads/
  discover/          Places (grid tiling), county filter, mgmt directory harvest
  enrich/            Firecrawl, owner chain, registries, playbooks
  request/           NL planner + deterministic fulfiller
  resolve/           contact hierarchy, verification, heuristic lead_score
  pipeline/          run orchestration (single-pass discover + enrich), campaigns, dedupe
  db/                LeadStore (Supabase Postgres via psycopg) + local SQLite caches
  eval/              stage-traced eval replay
supabase/            canonical schema (migrations) + partner-api Edge Function
dashboard/           local Next.js developer/operator/observer console
data/                local-only runtime (canonical data lives in Supabase)
  local_cache.db     page_cache / domain_cache / extraction_cache
  raw_archive.db     compressed raw API payloads for eval replay
  runs/{run_id}/     manifest.json, raw jsonl, export.csv per run
  exports/           request deliverables
```

Per-category rules (`min_contact_bar`, `allow_owner_chain`, etc.) live in `config/categories.yaml`.

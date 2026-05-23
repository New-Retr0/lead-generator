# PALLARES Lead Generator

Repeatable commercial property lead pipeline for **PALLARES** exterior cleaning brokerage.

**Stack:** Google Places API (discovery) → Firecrawl (gap-fill enrichment) → Python (dedupe, contacts) → CSV + Google Sheets.

Processed leads are tracked in a local **SQLite database** (`data/pallares.db`) so re-runs skip already-enriched leads and avoid wasting Firecrawl credits.

Google Places finds the business; Firecrawl fills what Places misses — website, phone, contact name, property manager, and evidence URLs (especially shopping centers and strip malls with no Google website).

## Setup

```powershell
cd "C:\Users\Austi\Documents\Projects\pallares-lead-generator"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
copy .env.example .env
# Fill in .env — see .env.example for all keys
# Put the Google service account JSON in secrets/google-service-account.json
```

### Google Cloud

Full walkthrough: **[docs/GOOGLE-PLACES-SETUP.md](docs/GOOGLE-PLACES-SETUP.md)**

1. [Google Cloud Console](https://console.cloud.google.com/) → create/select project + enable billing.
2. Enable **Places API (New)** (not legacy Places API).
3. [Credentials](https://console.cloud.google.com/apis/credentials) → **Create credentials → API key**.
4. Restrict key to **Places API (New)** only.
5. Set `GOOGLE_PLACES_API_KEY` in `.env`.
6. Verify: `pallares-leads doctor`

## Usage

```powershell
# Full run for one market + category (Places + Firecrawl → CSV + Sheets)
pallares-leads run --market reedley --category gas_station

# Smoke sample: 5 enriched leads per category in Reedley (good first test)
pallares-leads smoke-sample

# Smoke sample across all campaign cities
pallares-leads smoke-sample --all-markets

# Full campaign matrix (all markets × categories, optional limit)
pallares-leads run-campaign --limit 20

# All categories in one city
pallares-leads run --market reedley --all-categories --limit 10

# Discovery only (no Firecrawl — saves credits while testing Places)
pallares-leads run --market reedley --category gas_station --discover-only

# Dry-run: print queries without calling APIs
pallares-leads run --market reedley --category gas_station --dry-run

# Re-enrich leads already in the DB (uses Firecrawl credits)
pallares-leads run --market reedley --category gas_station --force-refresh

# Re-enrich leads not touched in 30+ days
pallares-leads run-campaign --refresh-after-days 30

# Seed the DB from existing CSV/JSONL exports (run once after upgrading)
pallares-leads db import

# Check what's in the ledger
pallares-leads db status
pallares-leads db profiles          # learned enrichment playbooks
pallares-leads db lead places/abc   # canonical enriched_json for one lead
pallares-leads db report <run_id>   # stage credits from run_events
pallares-leads db import-feedback   # pull Addressed + Notes from Sheets

# Replay saved raw JSONL through enrichment with stage-traced eval reports
pallares-leads eval-replay --from-jsonl data/raw --db-only --batch-size 3

# Skip LLM judge (heuristic scores only)
pallares-leads eval-replay --from-jsonl data/raw --no-judge

# Full eval with one-time Sheets sync at end
pallares-leads eval-replay --from-jsonl data/raw --db-only --sync-sheets

# List configured markets, categories, and campaigns
pallares-leads list
```

Eval output lands in `data/evals/{run_id}/` (gitignored): per-lead stage reports, LLM judge verdicts (AI Gateway), batch summaries, snapshot diffs, and `FINDINGS.md`.

Output: `data/output/{market}_{category}_{date}.csv` and, when configured, new rows append to Google Sheets (column A = **Addressed** checkbox).

To migrate an existing sheet to the new slim sales layout:

```powershell
# Migrate sheet to slim layout, or sync from canonical DB (preferred)
pallares-leads sync-sheets --all --rewrite
pallares-leads sync-sheets --from-db
```

## Project layout

```
config/           markets + search categories (YAML)
src/pallares_leads/
  discover/       Google Places Text Search + Details
  enrich/         Firecrawl (map, scrape+JSON, search) + optional Agent + AI Gateway copy
  resolve/        contact hierarchy + confidence
  pipeline/       dedupe, orchestration, CSV export, SQLite ledger
  eval/           stage-traced eval replay harness
data/
  pallares.db     lead ledger (gitignored — local only)
  raw/            jsonl discovery snapshots
  snapshots/      scraped markdown per lead
  output/         CSV exports
  evals/          eval replay reports (gitignored)
```

## Enrichment tiers (Firecrawl credits)

Default pipeline per lead:

1. **Map + scrape+JSON** (~6 cr) — contact extraction from website
2. **Search + scrape+JSON** (~6 cr) — only when contact bar not met (corporate locators, missing phone)
3. **Agent** (up to 75 cr) — **off by default**; last resort only when enabled in `.env` and `categories.yaml`

Contact requirements (`min_contact_bar`, `allow_agent`, etc.) are configured in `config/categories.yaml` under `enrichment_defaults` and per-category `enrichment:` blocks — not hardcoded in Python.

To re-enable Agent for stubborn corporate locators (e.g. Shell on `find.shell.com`):

```powershell
# .env
FIRECRAWL_AGENT_ENABLED=true
```

Optionally set `allow_agent: true` on specific categories in `config/categories.yaml`.

## MVP scope

- Find commercial properties matching target profile
- Investigate public websites for best reachable contact
- Export CSV for manual call/email follow-up
- **Not included:** CRM, outreach automation, lead scoring, email enrichment APIs

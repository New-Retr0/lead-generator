# PALLARES Lead Generator

Repeatable commercial property lead pipeline for **PALLARES** exterior cleaning brokerage.

**Stack:** Google Places API (discovery) → Firecrawl (website enrichment) → Python (dedupe, contacts, CSV).

No Browser Use or SerpAPI in v1 — one discovery API, one scrape API.

## Setup

```powershell
cd "C:\Users\Austi\Documents\Projects\pallares-lead-generator"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
copy .env.example .env
# Add GOOGLE_PLACES_API_KEY and FIRECRAWL_API_KEY to .env
```

### Google Cloud

1. Create/select a GCP project.
2. Enable **Places API (New)**.
3. Create an API key restricted to Places API (New).
4. Set `GOOGLE_PLACES_API_KEY` in `.env`.

## Usage

```powershell
# Full run for one market + category
pallares-leads run --market reedley --category gas_station

# All categories in one city
pallares-leads run --market reedley --all-categories

# Discovery only (no Firecrawl — saves credits while testing Places)
pallares-leads run --market reedley --category gas_station --discover-only

# Dry-run: print queries without calling APIs
pallares-leads run --market reedley --category gas_station --dry-run
```

Output: `data/output/{market}_{category}_{date}.csv`

## Project layout

```
config/           markets + search categories (YAML)
src/pallares_leads/
  discover/       Google Places Text Search + Details
  enrich/         Firecrawl scrape + contact extraction
  resolve/        contact hierarchy + confidence
  pipeline/       dedupe, orchestration, CSV export
data/
  raw/            jsonl discovery snapshots
  snapshots/      scraped markdown per lead
  output/         CSV exports
```

## MVP scope

- Find commercial properties matching target profile
- Investigate public websites for best reachable contact
- Export CSV for manual call/email follow-up
- **Not included:** CRM, outreach automation, lead scoring, email enrichment APIs

## Learned User Preferences

- Primary Google Sheets consumer is a sales friend doing outreach — keep exports sales-focused, not dev/audit columns.
- Prefer hybrid Firecrawl enrichment: Map → targeted scrape/extract first; relational profile reuse for franchise locations; Agent only when contact gaps remain after cheaper tiers.
- Enrichment behavior belongs in `config/categories.yaml`, not hardcoded per-category logic in Python.
- Minimize relational duplication — reuse learned enrichment playbooks for franchise locations and repeated property-management companies instead of re-running full Firecrawl.
- Google Sheets must auto-format on every export (Exo 2, 12pt, bold, column widths, wrap, hyperlinks) without manual resizing.
- Include talking points and "Why Call" notes for sales; avoid generic fallback boilerplate in exported text.
- Callable contacts with phone numbers and role labels matter more than separate Property Manager or Role columns for most leads.
- Do not duplicate Website with a Source column; drop unnecessary right-side audit columns from the sales export.
- Column A "Addressed" checkbox must persist across re-imports (match rows by place id, do not overwrite checked state).
- Only git commit and push when explicitly requested.
- Real credentials live in `.env` and `secrets/` — never commit API keys or service account JSON.

## Learned Workspace Facts

- Python CLI `pallares-leads` pipeline for PALLARES exterior cleaning commercial property leads in California's Central Valley.
- Stack: Google Places API (New) discovery → Firecrawl Map/scrape gap-fill → AI Gateway sales copy → CSV plus Google Sheets export.
- GitHub remote: `New-Retr0/pallares-lead-generator` on branch `main`.
- Campaign matrix in `config/campaign.yaml` (`central_valley`): Reedley, Dinuba, Selma, Kingsburg, Sanger, Fresno, Visalia × fourteen property categories.
- `property_manager` runs at Fresno County level via `county_overrides` in campaign config, not per city.
- Target categories: gas_station, fast_food, strip_mall, shopping_center, grocery, medical_plaza, pharmacy, bank, industrial, big_box, restaurant, parking, hoa, property_manager.
- Per-category enrichment rules live in `config/categories.yaml` (`min_contact_bar`, `franchise_fast_path`, `require_property_manager_clue`, `always_investigate`, `allow_agent`).
- Canonical lead state in SQLite (`data/pallares.db`); full enriched payloads in `data/raw/*.jsonl` and `data/snapshots/`; slim `SalesExportRow` for CSV/Sheets.
- Relational learning uses `enrichment_profiles` (franchise location keys and management-company domains) to skip redundant Firecrawl/Agent work.
- Google Sheets auth uses a service account JSON at `secrets/google-service-account.json` plus `GOOGLE_SHEETS_SPREADSHEET_ID`; default tab is `Leads`.
- Key CLI commands: `smoke-sample`, `run`, `run-campaign` (default `--skip-known`; `--force-refresh` to re-enrich), `sync-sheets --rewrite`, `db status|import|profiles|lead|report`, `eval-replay` (stage traces + optional AI Gateway judge), `doctor`, `list`.
- Sheets sort by Category then City with row-1 filters; setup guide at `docs/GOOGLE-PLACES-SETUP.md`.

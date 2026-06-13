## Learned User Preferences

- Primary business goal: maximize verified decision-maker callable leads for sales outreach (10% commission on closed deals); quality right-person phones beat raw volume.
- Primary Google Sheets consumer is a sales friend doing outreach — keep exports sales-focused, not dev/audit columns.
- Single-pass lead generation — no separate enrich pipeline; discovery and enrichment run together per place (`skip_known` default).
- Vendor leads (`vendor_` category prefix) are distinct from client targets — CRM Vendors tab in dashboard, never Google Sheets export.
- State licensing/registry lookups must be config-driven per state (`config/licensing.yaml`, `config/jurisdictions.yaml`), not California-hardcoded.
- Prefer hybrid Firecrawl enrichment with templated searches in `config/search_templates.yaml` for predictable outputs and cost control.
- Enrichment behavior in `config/categories.yaml`; reuse playbooks, page_cache, and owner_records instead of re-running full Firecrawl/Browser Use.
- Owner-chain county recorder lookups use free grantor/grantee index only — never purchase deed images.
- Google Sheets auto-format on every export (Exo 2, 12pt, bold, column widths, wrap, hyperlinks); Addressed checkbox persists across re-imports and `--rewrite` (match by place id).
- Sales exports lean — talking points and Why Call notes, callable contacts with role labels, no PM/Role/duplicate Source/Website/audit columns.
- Only git commit and push when explicitly requested.
- Real credentials live in `.env` and `secrets/` — never commit API keys or service account JSON.

## Learned Workspace Facts

- Python CLI `pallares-leads` for PALLARES commercial exterior-cleaning leads; campaign matrix `central_valley` (7 cities × expanded categories); markets also include LA/OC/Reedley and vendor-scout cities in `config/markets.yaml`.
- Stack: Google Places / Overpass → Firecrawl Map/scrape/search → Browser Use owner chain → AI Gateway (sales copy + NL parsing only) → CSV + Google Sheets.
- Dashboard at `dashboard/` (Next.js + shadcn, Geist + glass UI) reads `data/pallares.db`; spawns CLI with repo-root `.env`.
- Nav: Pipeline (`/requests`, `/runs`) vs Sales (`/crm`, `/leads`, `/triage`) vs Operations (`/costs`); triage at `/triage` redirects from `/duds`.
- `/crm` shared CRM statuses via `sales_feedback.status` (New → Bad Data); PATCH `/api/leads/[placeId]` persists from dashboard.
- `vendor_` category prefix = vendor leads; excluded from Sheets; `vendor_pressure_washing` scans insurance keywords from fetched markdown (zero extra credits).
- Per-category enrichment in `config/categories.yaml`; search templates in `config/search_templates.yaml`; state licensing in `config/licensing.yaml`; portals in `config/jurisdictions.yaml`.
- Canonical state in SQLite; `SalesExportRow` Score gating; relational learning via `enrichment_profiles` and `owner_records`.
- Cost in `cost_events` with per-lead USD; `pallares-leads db report|prune <run_id>`; dashboard lead/run modals show expandable tool-call breakdowns.
- Parallel enrichment: `enrichment_parallel_workers` (Firecrawl concurrent, AI Gateway serialized spacing); `skip_known` default avoids re-processing known places.
- Verification: `lead_facts` ledger + grounding gate; `verification_level`; BBB registry; atomic contacts never blend Google phone with scraped names.
- Key CLI: `run`, `run-campaign`, `smoke-sample`, `request`, `sync-sheets`, `warm-portals`, `harvest-managers`, `db report|prune`, `doctor`, `list`; `PALLARES_LOG_JSON=1` + `JobTimeline` for live observability.

## Learned User Preferences

- Primary business goal: maximize verified decision-maker callable leads for sales outreach (10% commission on closed deals); quality right-person phones beat raw volume.
- Primary sales surface is the deployed **sales-app** website (magic-link CRM) — sales-focused views, not dev/audit columns.
- Single-pass lead generation — no separate enrich pipeline; discovery and enrichment run together per place (`skip_known` default).
- Vendor leads (`vendor_` category prefix) are distinct from client targets — visible in CRM with vendor filter; reps see vendors via full read parity.
- State licensing/registry lookups must be config-driven per state (`config/licensing.yaml`, `config/jurisdictions.yaml`), not California-hardcoded.
- Prefer hybrid Firecrawl enrichment with templated searches in `config/search_templates.yaml` for predictable outputs and cost control.
- Enrichment behavior in `config/categories.yaml`; reuse playbooks, page_cache, and owner_records instead of re-running full Firecrawl/Browser Use.
- Owner-chain county recorder lookups use free grantor/grantee index only — never purchase deed images.
- Only git commit and push when explicitly requested.
- Real credentials live in `.env` and `secrets/` — never commit API keys or service account JSON.

## Learned Workspace Facts

- Python CLI `pallares-leads` for PALLARES commercial exterior-cleaning leads; campaign matrix `central_valley` (7 cities × expanded categories); markets also include LA/OC/Reedley and vendor-scout cities in `config/markets.yaml`.
- Stack: Google Places / Overpass → Firecrawl Map/scrape/search → Browser Use owner chain → AI Gateway (sales copy + NL parsing only) → **Supabase Postgres** (canonical).
- **Canonical database**: Supabase project `pallares-leads`; schema in `supabase/migrations/`; Python writes via `psycopg` + `SUPABASE_DB_URL` (direct `db.<ref>.supabase.co` connection).
- **Operator dashboard** at `dashboard/` (local, no login): reads/writes Postgres via `postgres` npm on `SUPABASE_DB_URL` (bypasses RLS); spawns CLI jobs for runs/requests/doctor.
- **Sales app** at `sales-app/` (Vercel): `@supabase/ssr` + anon key; reps get **full read parity** (leads incl. vendors, runs, costs, requests) but **CRM-only writes** on `sales_feedback` (RLS).
- Nav (both apps): Pipeline (`/requests`, `/runs`) vs Sales (`/crm`, `/leads`, `/triage`) vs Operations (`/costs`); triage at `/triage` redirects from `/duds`.
- `/crm` shared CRM statuses via `sales_feedback.status` (New → Bad Data); PATCH `/api/leads/[placeId]` persists CRM fields.
- `vendor_` category prefix = vendor leads; `vendor_pressure_washing` scans insurance keywords from fetched markdown (zero extra credits).
- Per-category enrichment in `config/categories.yaml`; search templates in `config/search_templates.yaml`; state licensing in `config/licensing.yaml`; portals in `config/jurisdictions.yaml`.
- Relational learning via `enrichment_profiles` and `owner_records`; `sales_leads` view for sales-facing list.
- Cost in `cost_events` with per-lead USD; `cost_by_day` / `cost_by_provider` views; `pallares-leads db report|prune <run_id>`; dashboard lead/run modals show expandable tool-call breakdowns.
- **Local-only caches**: `page_cache` + `domain_cache` in `data/local_cache.db` (not in Supabase — protects free-tier DB cap).
- Parallel enrichment: `enrichment_parallel_workers` (Firecrawl concurrent, AI Gateway serialized spacing); `skip_known` default avoids re-processing known places.
- Verification: `lead_facts` ledger + grounding gate; `verification_level`; BBB registry; atomic contacts never blend Google phone with scraped names.
- Key CLI: `run`, `run-campaign`, `smoke-sample`, `request`, `warm-portals`, `harvest-managers`, `db report|prune`, `doctor`, `list`; `PALLARES_LOG_JSON=1` + `JobTimeline` for live observability.
- Invite sales reps: `python scripts/create_auth_user.py <email>` (or Supabase Studio → Add user with **Auto Confirm User** checked).
- Env: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`; sales-app/Vercel uses `NEXT_PUBLIC_SUPABASE_*` only (never service role on Vercel).

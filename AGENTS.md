## Learned User Preferences

- Primary business goal: maximize verified decision-maker callable leads for sales outreach (10% commission on closed deals); quality right-person phones beat raw volume. Owner targets: sidewalks, glass storefronts, parking lots/dumpster pads — strip/outdoor malls, QSR franchisees, gas stations, restaurants with own lots; contacts: facilities manager, maintenance manager, property/land owner.
- Deployed **sales-app** (Vercel) is the **Developer Console** for pipeline ops (jobs, runs, costs, partner API) — not the primary CRM; local **dashboard/** holds CRM (`/crm`, `/leads`, `/triage`).
- Single-pass lead generation — no separate enrich pipeline; discovery and enrichment run together per place (`skip_known` default).
- Vendor leads (`vendor_` category prefix) are distinct from client targets — visible in CRM with vendor filter; reps see vendors via full read parity.
- State licensing/registry lookups must be config-driven per state (`config/licensing.yaml`, `config/jurisdictions.yaml`), not California-hardcoded.
- Prefer hybrid Firecrawl enrichment with templated searches in `config/search_templates.yaml` for predictable outputs and cost control.
- Enrichment behavior in `config/categories.yaml`; reuse playbooks, page_cache, and owner_records instead of re-running full Firecrawl/Browser Use.
- Owner-chain county recorder lookups use free grantor/grantee index only — never purchase deed images.
- Only git commit and push when explicitly requested.
- Real credentials live in `.env` and `secrets/` — never commit API keys or service account JSON.

## Learned Workspace Facts

- Python CLI `pallares-leads`; campaign `central_valley` (7 cities × expanded categories). Expansion geography: HI, OR, WA, CA excluding LA/OC counties, NM, NV, AZ (eventual US-wide); `tile_circles` grid tiling and `exclude_counties` campaign filter support wide-area discovery; markets in `config/markets.yaml`.
- Stack: Google Places / Overpass → Firecrawl v2 (map/scrape/search) → AI Gateway contact extract + sales copy → Browser Use or Firecrawl agent owner chain → **Supabase Postgres** (canonical).
- **Canonical database**: Supabase project `pallares-leads`; schema in `supabase/migrations/`; Python writes via `psycopg` + `SUPABASE_DB_URL` (direct `db.<ref>.supabase.co` connection).
- **Operator dashboard** at `dashboard/` (local, no login): primary CRM + reads/writes Postgres via `postgres` npm on `SUPABASE_DB_URL` (bypasses RLS); spawns CLI jobs for runs/requests/doctor.
- **Developer Console** at `sales-app/` (Vercel): `@supabase/ssr` + anon key; full read on leads/runs/costs/jobs; enqueue via `/jobs` (pgmq); **Supabase Realtime** on `run_events`, `cost_events`, `worker_status` for live run modal + overview widgets; Command nav (`/jobs`, `/requests`, `/runs`) and Operations (`/costs`, `/partner-api`).
- **Partner API**: Edge Function `supabase/functions/partner-api/` — hashed keys, `x-api-key` or Bearer, cursor sync, rate limits; OpenAPI `docs/partner-api.openapi.yaml`; admin key CRUD at `/api/admin/partner-keys` (`is_admin` + server-only service role).
- `vendor_` category prefix = vendor leads; per-category enrichment in `config/categories.yaml`; search templates in `config/search_templates.yaml`; state licensing in `config/licensing.yaml`; portals in `config/jurisdictions.yaml`.
- Relational learning via `enrichment_profiles` and `owner_records`; `sales_leads` view for sales-facing list; decision-maker role ranking in `apply.py` (facilities/maintenance/property manager, owner).
- Cost in `cost_events` with per-lead USD; `cost_by_day` / `cost_by_provider` views; `pallares-leads db report|prune <run_id>`; dashboard lead/run modals show expandable tool-call breakdowns.
- **Local-only caches**: `page_cache` + `domain_cache` in `data/local_cache.db` (not in Supabase — protects free-tier DB cap); parallel enrichment via `enrichment_parallel_workers` (Firecrawl concurrent, AI Gateway serialized spacing).
- Verification: `lead_facts` ledger + grounding gate; `verification_level`; BBB registry; atomic contacts never blend Google phone with scraped names.
- Key CLI: `run`, `run-campaign`, `smoke-sample`, `request`, `warm-portals`, `harvest-managers`, `db report|prune`, `doctor`, `worker`, `list`; `PALLARES_LOG_JSON=1` persists progress to `run_events` (Realtime); local dashboard uses SSE job streams.
- Env: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`; sales-app uses `NEXT_PUBLIC_SUPABASE_*`; optional server-only `SUPABASE_SERVICE_ROLE_KEY` on Vercel for admin partner-key routes (never in browser).

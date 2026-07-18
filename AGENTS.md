## Learned User Preferences

- Primary business goal: maximize verified decision-maker callable leads for sales outreach (10% commission on closed deals); quality right-person phones beat raw volume. Owner targets: sidewalks, glass storefronts, parking lots/dumpster pads — strip/outdoor malls, QSR franchisees, gas stations, restaurants with own lots; contacts: facilities manager, maintenance manager, property/land owner.
- Product is API-first: the sellable surface is the Partner API; new lead-lifecycle features must land there before or with internal UI; `dashboard/` is the local operator console.
- Local **dashboard/** (`localhost:3000`) is the solo-founder developer/operator/observer console for pipeline ops (launch, runs, costs, data, learning, settings). It is not a CRM and is the only in-repo app surface.
- Prioritize operational cost transparency: per-provider USD breakdown, duration_ms on pipeline operations, and dashboard trend views so spend sources and rate changes are visible.
- Single-pass lead generation — no separate enrich pipeline; discovery and enrichment run together per place (`skip_known` default).
- Vendor leads (`vendor_` category prefix) are distinct from client targets — `sales_leads.is_vendor` via `category_key LIKE 'vendor_%'`; visible in Data with the vendor filter and available through Partner API read parity.
- All pipeline behavior is config-driven, never hardcoded: markets (`config/markets.yaml`), categories/enrichment (`config/categories.yaml`), campaigns (`config/campaign.yaml`), search templates (`config/search_templates.yaml`), state licensing (`config/licensing.yaml`), recorder/SOS portals (`config/jurisdictions.yaml`), provider pricing (`config/pricing.yaml`), learned score (`config/learned_score.yaml`).
- Prefer hybrid Firecrawl enrichment with templated searches for predictable outputs and cost control; reuse playbooks, page_cache, and owner_records instead of re-running full Firecrawl.
- Owner-chain county recorder lookups use free grantor/grantee index only — never purchase deed images.
- Only git commit and push when explicitly requested.
- Real credentials live in `.env` and `secrets/` — never commit API keys or secret files.

## Repository Structure

- `src/pallares_leads/` — Python package; CLI `pallares-leads` (`cli.py`). Subpackages:
  - `pipeline/` — `run_market.py` (single-pass discover+enrich per market×category), `run_campaign.py` (campaign matrix, `exclude_counties`), `dedupe.py` (place_id/fingerprint/phone/domain).
  - `discover/` — `places.py` (Google Places + `tile_circles` grid tiling), `overpass.py` (OSM), `county_filter.py`, `mgmt_directory.py` (`harvest-managers`).
  - `enrich/` — `firecrawl_client.py` (scrape+JSON extract), `apply.py` (`_ROLE_PRIORITY` decision-maker ranking), `lead_profile.py` (playbooks + fast path), `owner_chain.py`, registries (BBB, license lookup).
  - `resolve/` — `verification.py` (`verification_level`), `lead_score.py` (heuristic 0–100 + optional learned blend), `triggers.py`, `contact_hierarchy.py`.
  - `db/` — `store.py` (`LeadStore`, all Supabase I/O via psycopg), `local_cache.py` (SQLite `data/local_cache.db`), `raw_archive.py` (SQLite `data/raw_archive.db`).
  - `intelligence/` — `features.py` (`build_feature_snapshot()` → `lead_features`), `analyze.py` (`insights` CLI, `--fit-score`).
  - `eval/` — `replay.py`/`compare.py`/`score.py` regression harness over archived raw leads (`eval-replay`).
  - `request/` — NL lead requests: `planner.py`, `fulfill.py` (DB-first reuse, then gap-fill).
  - `queue_worker.py` — consumes pgmq `pipeline_jobs`, spawns CLI subprocesses with allowlisted env overrides.
- `config/` — all YAML behavior (see preferences above).
- `dashboard/` — local Next.js developer/operator/observer console (no login, direct Postgres via `postgres` npm, bypasses RLS). Routes: `/`, `/runs`, `/runs/[id]`, `/requests`, `/campaigns`, `/data`, `/costs`, `/settings`; legacy `/crm`, `/leads`, `/triage`, `/duds` routes only redirect into `/data`. Spawns local CLI jobs with SSE streams today; `pipeline_jobs`/pgmq is a separate worker execution path. Writes structured outcomes/touches via `lib/db-write.ts`.
- `supabase/` — canonical schema in `migrations/`; Edge Function `functions/partner-api/` (hashed keys, cursor sync, rate limits, outcome/touch endpoints with `leads:feedback` scope); OpenAPI at `docs/partner-api.openapi.yaml`; partner keys are managed with `scripts/create_partner_api_key.py`.
- `scripts/` — ops utilities (partner keys, market generation, cost audit, DB wipe).
- `docs/` — index in `docs/README.md`; Partner OpenAPI `partner-api.openapi.yaml`; yield pack, Places setup, lead intelligence, api-first architecture.
- `data/` — local-only runtime: `local_cache.db`, `raw_archive.db`, `runs/`, `insights/`, `us_cities_30k.csv`. Never canonical; Supabase Postgres is.
- `tests/` — pytest suite incl. golden regression fixtures; CI bootstraps Postgres.

## Data Flywheel — how accumulated data improves future leads

Every run both consumes and produces learning data. The loops, cheapest first:

1. **Skip/dedupe** — `skip_known` (default) checks `leads.last_enriched_at`; `dedupe.py` collapses by place_id/fingerprint/phone/domain; `request/fulfill.py` serves from DB before spending on new discovery.
2. **Local caches** — `page_cache`/`domain_cache`/`extraction_cache` in `data/local_cache.db` (TTL'd, pruned via `db prune`); `raw_archive.db` keeps compressed raw API payloads for feature replay and eval without re-fetching.
3. **Enrichment playbooks** — `enrichment_profiles` keyed `{property_type}:{site_kind}:{brand}` (or `mgmt:{company}`): successful enrichments write playbooks (`winning_tier`, `trust_google_phone`, `skip_firecrawl`, role labels) via `learn_playbook_from_outcome()`; future runs load/merge them and take the fast path, skipping Firecrawl when prior successes exist.
4. **Owner-chain reuse** — `owner_records` keyed by normalized entity name: SOS/recorder results transfer across places owned by the same entity; `get_related_leads()` links leads by owner/mgmt/domain.
5. **Verification ledger** — `lead_facts` (fact + source + quote + verification) feeds the grounding gate and `verification_level`; atomic contacts never blend Google phone with scraped names.
6. **Outcome learning (lead intelligence)** — the closed loop:
   - Each enriched lead writes a ~70-key feature snapshot to `lead_features` (`intelligence/features.py`, `FEATURE_VERSION`).
   - Sales reality flows back through operator feedback and Partner API into compatibility table `sales_feedback`, structured `lead_outcomes` (won/lost/bad_data/unqualified + quality rating, deal value), and `lead_touches` (call/email results incl. `dm_reached`/`wrong_number`); a legacy trigger can derive outcomes from closed feedback statuses.
   - Views `lead_labels` (label_good, engagement ladder, reached_dm) and `feature_outcomes` (features ⨝ labels) feed `pallares-leads insights`: correlations, win rates by category/market/role, score calibration, cost-per-win; reports land in `data/insights/` and `insight_reports`.
   - With ≥150 labels, `insights --fit-score` writes logistic coefficients to `config/learned_score.yaml`; `lead_score.py` blends them with the heuristic score via `learned_score_weight` (default 0 until validated).
7. **Cost feedback** — `cost_events` per operation with USD (`pricing.yaml`); views `cost_by_day/provider/run/model`; live Firecrawl team remaining stops enrichment when credits hit zero; `_cost_per_win()` ties spend to outcomes so budget shifts toward categories/markets that close.
8. **Eval harness** — `eval-replay` re-runs enrichment on archived raw leads with stage traces and golden-fixture regression tests, so pipeline changes are validated against real historical data before deploying.

Direction over time: more closed outcomes → better labels → learned score outranks heuristics → discovery/enrichment budget concentrates on segments with proven win rates; playbooks and owner records make each repeat segment cheaper to enrich.

## Learned Workspace Facts

- Campaigns in `config/campaign.yaml`: `central_valley` (7 cities × expanded categories) plus expansion `hawaii`, `oregon`, `washington`, `arizona`, `nevada`, `new_mexico`, `california_expansion` (with `exclude_counties: [los_angeles_ca, orange_ca]`); `scripts/generate_state_markets.py` + `data/us_cities_30k.csv` generate market entries; `tile_circles` grid tiling + `discover/county_filter.py` support wide-area discovery.
- Stack: Google Places / Overpass → Firecrawl v2 (map/scrape/search/agent) → grounded structured contact extraction → deterministic registries + Firecrawl agent owner chain → **Supabase Postgres** (canonical, project `pallares-leads`; Python via `psycopg` + `SUPABASE_DB_URL` direct connection).
- Key tables: `leads`, `runs`, `run_events`, `cost_events`, `enrichment_profiles`, `owner_records`, `lead_facts`, `sales_feedback`, `lead_requests`/`request_leads`, `partner_api_keys`/`partner_api_requests`, `pipeline_jobs` (+pgmq), `worker_status`, and intelligence: `lead_features`, `lead_outcomes`, `lead_touches`, `insight_reports`; views `sales_leads`, `lead_labels`, `feature_outcomes`, cost/trend analytics views, rollup cron.
- Key CLI: `run`, `run-campaign`, `smoke-sample`, `request`, `harvest-managers`, `insights`, `eval-replay`, `db status|report|prune|profiles|lead|archive-stats|import`, `doctor`, `worker`, `list`, `settings-schema`; `PALLARES_LOG_JSON=1` persists progress to `run_events` (Realtime); local dashboard uses SSE job streams.
- Parallel enrichment derived from Firecrawl plan concurrency via `FirecrawlClient.effective_parallel_workers()` (`max(1, plan_concurrency // 2)` — Standard 50 → 25 place workers); enrichment stops when live team remaining ≤ 0.
- Optional install extras: `.[dev]` for tests, `.[analysis]` (pandas/scikit-learn/scipy) required for `insights`.
- Env: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`; scoring knobs `learned_score_weight`, `learned_score_min_labels`, `min_export_score`.
- ASCII hero animations live in `dashboard/public/animations/{computer,cube,planet,wave}/` with `low/` and `medium/` frame sets only — use `quality="medium"` (`high/` folders do not exist).
- Pipeline Studio (animated stage canvas + replay scrubber) targets dashboard `/runs/[id]` via polling on `/api/runs/[id]/events` and `/costs` (not Supabase Realtime).

## Recent System Updates (iterate log)

- **Lead intelligence layer** (newest): `lead_features` snapshots per run, structured `lead_outcomes`/`lead_touches` fed from operator and Partner API feedback, `insights` CLI with report persistence, optional learned score blending — this is the improve/iterate engine; see Data Flywheel above.
- **Raw archive**: `data/raw_archive.db` stores compressed raw Places/Firecrawl/AI payloads locally for feature replay and eval — distinct from `page_cache`, never in Supabase (free-tier cap).
- **Geographic expansion**: markets/campaigns for HI, OR, WA, AZ, NV, NM, CA-minus-LA/OC; county filtering and grid tiling shipped.
- **Pipeline Studio**: dashboard `/runs/[id]` port in progress (polling, stage canvas, video-style replay).
- **Dashboard growth**: `/campaigns` (run + cost estimate), `/data` explorer, `/settings` env + YAML config editor (`/api/settings`, `/api/config-files`), run detail page; `/insights` page removed (redirects `/` — insights are CLI + reports now).
- **Jobs queue**: `pipeline_jobs` + pgmq + `queue_worker.py` exists as the worker path; dashboard launch APIs currently use local file-backed `startJob()` spawns and must label the execution mode honestly.

# Multi-Tenant Hosted SaaS — Saved Planning Prompt

## What this document is

This file is a **saved, re-runnable planning prompt** for a future architecture exploration. It is **not** an implementation spec and **not** code.

**When to use it:** Paste the prompt below into a planning agent **before onboarding the first external customer** — when you are ready to explore turning Pallares Leads from a single-operator pipeline into a **hosted product** where customers buy lead-generation software/service, you run the servers, and one global database is scoped per client.

**What to expect from running it:** An architecture decision document plus a phased migration plan. The agent should produce recommendations and trade-off analysis, **not** ship code in the first pass.

**How to use it:**

1. Open a new planning session with full repo access (or at minimum `AGENTS.md`, `supabase/migrations/`, `config/`, `src/pallares_leads/`, `dashboard/`).
2. Copy everything inside the fenced **PROMPT** block below (from `---BEGIN PROMPT---` through `---END PROMPT---`).
3. Paste it as the user message. Review the output, iterate on open questions, then use the phased plan to drive implementation work in separate sessions.

---

## PROMPT (copy from here)

---BEGIN PROMPT---

You are an architecture planning agent for the **Pallares Leads** lead-generation platform. Your job is to produce an **architecture decision document** and **phased migration plan** for evolving from today's single-tenant operator setup to a **multi-tenant hosted SaaS** where external customers subscribe, run discovery/enrichment pipelines scoped to their account, and are billed for usage.

Do **not** write production code in this session. Produce analysis, trade-offs, a decision matrix, a recommended architecture, and a phased migration plan.

---

### Context: current single-tenant architecture

Read `AGENTS.md` and `supabase/migrations/` to validate details. As of today:

#### Database and tenancy

- **One Supabase project** (`pallares-leads`) is the canonical Postgres store.
- **No `tenant_id` column** anywhere. All tenant-scoped tables (`leads`, `runs`, `run_events`, `cost_events`, `lead_requests`, `enrichment_profiles`, `owner_records`, `lead_facts`, `sales_feedback`, `pipeline_jobs`, etc.) are global.
- **Row Level Security (RLS)** is enabled on core tables. Policies grant **full read parity to any `authenticated` user** (`using (true)` on select). The only rep-writable surface is CRM fields on `sales_feedback` (status, addressed, feedback_notes).
- **`app_state`** has RLS on with **no authenticated policy** — operator-only via service role / direct DB connection.
- **Local operator dashboard** (`dashboard/`) connects with `SUPABASE_DB_URL` via `postgres` npm and **bypasses RLS** (direct Postgres). No login.
- No hosted customer console is currently in repo. The local operator dashboard (`dashboard/`) uses direct Postgres and bypasses RLS.

#### Identity and admin

- Historical Supabase Auth UI/admin routes were removed with the old hosted console. Partner API keys are currently managed by `scripts/create_partner_api_key.py`.
- **Partner API** (`supabase/functions/partner-api/`): hashed API keys in `partner_api_keys`, global (not scoped to tenant). Keys have scopes, rate limits, daily row limits. Edge function reads via service role; OpenAPI at `docs/partner-api.openapi.yaml`.

#### Worker and jobs

- **Python CLI** `pallares-leads` writes to Supabase via `psycopg` + `SUPABASE_DB_URL`.
- **Queue worker** (`queue_worker.py`) runs on the **operator machine**, reads credentials from **`.env`**, polls **pgmq** queue `pipeline_jobs`, spawns CLI subprocesses. Job enqueue flows through the dashboard job APIs.
- **`pipeline_jobs`** table tracks job metadata; `requested_by` links to `auth.users`. Per-run **`env_overrides`** (allowlisted keys like `FIRECRAWL_MAX_CREDITS_PER_RUN`, `BROWSER_USE_ENABLED`) can override worker subprocess env — but CLI-launched runs still use `.env` only.
- **`worker_status`** table + Realtime for live worker heartbeat.

#### Config

- **YAML on disk**, not in DB: `config/markets.yaml`, `config/categories.yaml`, `config/campaign.yaml`, `config/licensing.yaml`, `config/jurisdictions.yaml`, `config/search_templates.yaml`, `config/pricing.yaml`.
- Campaign example: `central_valley` (7 cities × expanded categories). Enrichment behavior is category-driven from `categories.yaml`.

#### Cost and observability ledger

- **`cost_events`** is a **per-tool-call granular financial ledger**: `provider`, `operation`, `model`, `units`, `unit_type`, `usd`, `place_id`, `run_id`, `request_id`, `meta_json` (stage, duration_ms, etc.). Indexed by run, place, provider, created_at. **Kept forever** (financial record).
- **`run_events`** stores pipeline progress per lead/stage (`stage`, `ran`, `duration_ms`, `meta_json`). Realtime-enabled. Retention policy (planned): prune rows older than 90 days after nightly rollup.
- **Aggregation views**: `cost_by_run`, `cost_by_day`, `cost_by_provider`, `cost_by_model`, `cost_by_market`, `cost_by_hour`; pipeline trend views (`stage_stats_by_run`, `stage_trends_by_day`, etc.) and `pipeline_daily_rollup` (planned).
- **Dashboard** run detail / Pipeline Studio work: replay DAG, granularity slider (run → provider → stage → operation → tool call), trends tab — fed from `run_events` + `cost_events` through polling REST endpoints.

#### Caches and isolation gaps

- **`page_cache` + `domain_cache`** live in **local SQLite** (`data/local_cache.db`) on the worker machine — not in Supabase. Protects free-tier DB cap; not shared across machines today.
- **`enrichment_profiles`** and **`owner_records`** are global learning tables (cross-lead, cross-run dedupe/reuse).
- **Leads keyed by `place_id`** (Google Places). No concept of "this business belongs to tenant A vs B."

#### Stack summary

Google Places / Overpass → Firecrawl v2 → AI Gateway contact extract + sales copy → Browser Use or Firecrawl agent owner chain → Supabase Postgres. Verification via `lead_facts`, `verification_level`, atomic contacts (never blend Google phone with scraped names).

---

### Exploration questions (answer each with what and why)

#### 1. Tenancy model trade-offs

Compare at minimum:

| Model | Notes to evaluate |
|-------|-------------------|
| Shared schema + `tenant_id` + per-tenant RLS | Single migration path, one Realtime channel namespace |
| Schema-per-tenant | Stronger isolation, harder migrations |
| Supabase-project-per-tenant | Maximum blast-radius isolation, highest ops cost |

Evaluate against:

- Supabase **free/pro tier caps** (DB size, Realtime connections, Edge Function invocations)
- **Migration tooling** (`supabase/migrations/` today is single-project)
- **Realtime vs polling** (current dashboard polls `run_events`, `cost_events`, and `worker_status`; future hosted clients may subscribe)
- **Blast radius** (one tenant's bad query vs cross-tenant data leak)
- **Partner API** and Edge Functions (one deployment vs many)

**Deliver:** Decision matrix with scores or qualitative ratings and a recommended default for "first 5 customers" vs "50+ customers."

#### 2. Identity and access

- How does **Supabase Auth** map to tenants? (organizations, teams, custom claims, membership table?)
- Per-tenant roles: **owner** (billing, config, API keys), **admin** (runs, jobs, costs), **rep** (CRM read/write on their tenant's leads only)?
- How does today's **`is_admin` + global partner-key model** generalize? Should partner keys become **per-tenant** with tenant_id on `partner_api_keys`?
- What happens to the **local dashboard** (`dashboard/`) — retire, tenant-scoped login, or operator super-admin only?
- **Service role** usage: which operations stay server-only (enqueue, partner API, billing webhooks)?

#### 3. Worker multi-tenancy

- **Queue partitioning:** per-tenant pgmq queues vs one queue with `tenant_id` on `pipeline_jobs` payload?
- **Worker deployment:** single pool of workers vs dedicated workers per tier/tenant?
- **Provider credentials:** per-tenant Firecrawl/AI Gateway/Browser Use/Places keys vs **pooled keys** with per-tenant budgets?
- **Credit caps:** reuse semantics of `FIRECRAWL_SESSION_CREDIT_STOP` / `FIRECRAWL_MAX_CREDITS_PER_RUN` as per-tenant/per-run limits?
- **Local caches** (`page_cache`, `domain_cache`): per-tenant SQLite, Redis, Supabase table, or shared global cache with tenant-scoped keys?
- **Env and secrets:** move from operator `.env` to tenant-scoped secret store (Supabase Vault, external KMS)?

#### 4. Cost attribution and billing

- **`cost_events` is already per-call granular.** Adding `tenant_id` makes it the **metering ledger**. What else needs `tenant_id`? (`runs`, `run_events`, `pipeline_jobs`, `lead_requests`, …)
- **Stripe (or equivalent) usage-based billing:** aggregate `cost_events` how — raw provider cost passthrough, marked-up per-lead fee, hybrid subscription + overage?
- **Margin tracking:** provider USD in `cost_events.usd` vs price charged to customer; where is pricing config stored?
- **Invoicing cadence:** real-time balance, daily rollup, monthly invoice from `pipeline_daily_rollup`?
- **Free tier / trials:** how to cap discovery/enrichment without code forks?

#### 5. Config per tenant

- Migrate **YAML → DB-backed per-tenant config**: markets, categories, campaigns, licensing, jurisdictions, search templates.
- **YAML as platform defaults**, tenant overrides layered on top?
- **Validation and versioning:** how do tenants edit config — hosted customer console UI, API, or operator-managed only at first?
- **Campaign isolation:** can two tenants run the same market/category without interfering?

#### 6. Isolation and safety

- **Lead data ownership:** if two tenants discover the same `place_id`, who "owns" the lead row? Separate rows per tenant vs shared discovery cache with tenant-scoped enrichment overlays?
- **Dedupe strategy across tenants:**
  - Shared global `place_id` / `enrichment_profiles` / `owner_records` **lowers cost** but **leaks signal** (tenant A's enrichment benefits tenant B).
  - Fully isolated **raises cost** but satisfies strict data boundaries.
  - Hybrid: shared read-only discovery index, tenant-scoped contacts/CRM/enriched_json?
- **Data deletion / GDPR:** tenant offboarding — delete all rows with `tenant_id`, shared cache handling, retention of `cost_events` for accounting.
- **Rate limits and abuse:** per-tenant job concurrency, API rate limits, spend caps.

#### 7. Ops and migration path

- **Phase 0 (non-breaking):** add nullable `tenant_id` columns, backfill existing data as `tenant_id = 'pallares'`, deploy RLS policies that default to legacy behavior for that tenant.
- **Environments:** dev/staging/prod — one Supabase project or many?
- **Observability per tenant:** Pipeline Studio + trends views gain tenant filter; alerts on spend anomalies.
- **Migration tooling:** how to onboard tenant #2 without downtime; seed config from YAML templates.
- **Rollback strategy** if multi-tenant RLS has a bug in production.

---

### Required output format

Structure your response as follows:

#### A. Executive summary (1 page)

- Recommended tenancy model and why
- Top 3 risks and mitigations
- Estimated effort bands (S/M/L) for phases 1–3

#### B. Decision matrix

For **each** exploration question (1–7), provide a table:

| Option | Pros | Cons | Fit for 5 tenants | Fit for 50+ tenants | Verdict |
|--------|------|------|-------------------|---------------------|---------|

End each section with a **recommended choice** and **conditions that would change the recommendation**.

#### C. Recommended target architecture

- Diagram (mermaid or ASCII) of: Auth → tenant context → RLS → apps (dashboard, future hosted console, Partner API) → worker → providers → `cost_events` billing export
- Table of **schema changes** (new tables, new columns, new indexes, new RLS policies)
- Table of **app changes** (future hosted console, dashboard, edge functions, Python CLI/worker)
- **Secrets and config** layout per tenant

#### D. Phased migration plan

Minimum phases:

| Phase | Goal | Non-breaking? | Key deliverables |
|-------|------|---------------|------------------|
| **1** | Add `tenant_id` columns + backfill `'pallares'` | Yes | Migration SQL, updated write paths in Python, no RLS tightening yet |
| **2** | Tenant membership + RLS enforcement | Partial (flag-gated) | `tenants`, `tenant_members`, RLS policies, hosted console tenant switcher |
| **3** | Worker + queue tenant awareness | No for new tenants | Queue payload, worker context, per-tenant env/secrets |
| **4** | Billing meter + Stripe | No | `cost_events` export, pricing tables, usage webhooks |
| **5** | Per-tenant config UI | No | DB-backed markets/categories, admin UI |
| **6** | First external tenant onboarding | — | Runbook, docs, support tooling |

For each phase: prerequisites, migration steps, verification checklist, rollback note.

#### E. Open questions for product/business

List decisions that **cannot** be resolved by engineering alone (pricing model, data sharing policy, SLA, compliance).

#### F. Out of scope for this plan

Explicitly defer: full white-label, on-prem deploy, multi-region, SOC2 audit — unless you flag them as blockers.

---

### Constraints and principles to respect

- **`cost_events` stays the financial ledger** — do not replace with a separate billing-only table without a migration story.
- **Quality over volume** — per-tenant config must not fork enrichment logic into unmaintainable copies; keep `categories.yaml`-style behavior as data-driven rules.
- **Atomic contacts and verification** — tenant isolation must not re-introduce blended Google-phone + scraped-name contacts.
- **Partner API backward compatibility** — existing integrators may need a deprecation window.
- **Free-tier Supabase reality** — call out when the architecture outgrows a single project.

Begin by reading `AGENTS.md`, `supabase/migrations/20250616000100_core_schema.sql`, `supabase/migrations/20250616000400_rls_policies.sql`, `supabase/migrations/20260626000100_developer_console_partner_api.sql`, and `config/categories.yaml`. Then produce sections A–F.

---END PROMPT---

## Related docs

- [AGENTS.md](../../AGENTS.md) — current workspace facts and conventions
- [partner-api.md](../partner-api.md) — Partner API behavior today
- Live Pipeline Studio plan (`.cursor/plans/live_pipeline_studio_6c5c8d27.plan.md`) — granular cost/run event instrumentation feeding future per-tenant billing

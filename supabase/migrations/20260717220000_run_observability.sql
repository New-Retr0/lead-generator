-- Phase 4 run observability: stop reasons, yield counters, cache/owner-chain stats.
-- Additive only — does not rewrite prior migrations.

alter table public.runs
  add column if not exists job_id text,
  add column if not exists request_id text,
  add column if not exists stop_reason text,
  add column if not exists stop_detail text,
  add column if not exists duration_ms bigint,
  add column if not exists verified_dm_count int,
  add column if not exists partner_eligible_count int,
  add column if not exists grounding_rejections int,
  add column if not exists cache_hits int,
  add column if not exists playbook_hits int,
  add column if not exists owner_chain_attempts int,
  add column if not exists owner_chain_hits int,
  add column if not exists owner_chain_reuses int;

create index if not exists idx_runs_job_id
  on public.runs (job_id)
  where job_id is not null;

create index if not exists idx_runs_request_id
  on public.runs (request_id)
  where request_id is not null;

create index if not exists idx_runs_stop_reason
  on public.runs (stop_reason)
  where stop_reason is not null;

-- Table-level grants already cover new columns; reaffirm read access.
grant select on public.runs to authenticated;
grant select on public.runs to service_role;

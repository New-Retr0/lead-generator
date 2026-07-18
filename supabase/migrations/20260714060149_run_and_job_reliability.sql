-- Run/job reliability: persisted run failure reasons, worker heartbeats on
-- pipeline_jobs, run_id join key for live views, and worker presence.

alter table public.runs
  add column if not exists error text;

alter table public.pipeline_jobs
  add column if not exists worker_heartbeat_at timestamptz;

alter table public.pipeline_jobs
  add column if not exists run_id text;

-- Count of log lines trimmed off the front of `logs` (kept bounded at 10k).
-- Lets the live-log cursor stay an absolute line offset that survives trimming,
-- so long jobs never freeze or gap the streamed log/event view.
alter table public.pipeline_jobs
  add column if not exists log_offset integer not null default 0;

create index if not exists idx_pipeline_jobs_status_updated
  on public.pipeline_jobs (status, updated_at);

create index if not exists idx_pipeline_jobs_run_id
  on public.pipeline_jobs (run_id)
  where run_id is not null;

create index if not exists idx_pipeline_jobs_active
  on public.pipeline_jobs (status)
  where status in ('queued', 'running');

-- One row per worker host: presence + the job it is currently executing.
create table if not exists public.worker_status (
  worker_id text primary key,
  hostname text,
  pid integer,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  current_job_id uuid
);

alter table public.worker_status enable row level security;

drop policy if exists worker_status_select_authenticated on public.worker_status;
create policy worker_status_select_authenticated on public.worker_status
  for select to authenticated
  using (true);

grant select on public.worker_status to authenticated;
-- Writes happen only over the direct DB connection (postgres role) — no
-- insert/update/delete grants for anon/authenticated.
revoke insert, update, delete on public.worker_status from anon, authenticated;;

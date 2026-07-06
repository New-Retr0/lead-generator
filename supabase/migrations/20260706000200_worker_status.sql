-- Worker heartbeats, queue metrics RPC, and run ↔ job linkage.

create table if not exists public.worker_status (
  worker_id text primary key,
  hostname text,
  last_seen timestamptz not null default now(),
  current_job_id uuid references public.pipeline_jobs (id) on delete set null,
  status text not null default 'idle',
  meta_json jsonb not null default '{}'::jsonb,
  constraint worker_status_status_chk check (status in ('idle', 'busy', 'stopped'))
);

create index if not exists idx_worker_status_last_seen
  on public.worker_status (last_seen desc);

alter table public.worker_status enable row level security;

drop policy if exists worker_status_select_authenticated on public.worker_status;
create policy worker_status_select_authenticated on public.worker_status
  for select to authenticated
  using (true);

grant select on public.worker_status to authenticated;
grant all on public.worker_status to service_role;

alter table public.pipeline_jobs
  add column if not exists run_id text;

create index if not exists idx_pipeline_jobs_run_id
  on public.pipeline_jobs (run_id)
  where run_id is not null;

create or replace function public.get_pipeline_queue_metrics()
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  metrics pgmq.metrics_result;
  running_jobs integer;
  queued_jobs integer;
begin
  metrics := pgmq.metrics('pipeline_jobs');

  select count(*)::integer into running_jobs
  from public.pipeline_jobs
  where status = 'running';

  select count(*)::integer into queued_jobs
  from public.pipeline_jobs
  where status = 'queued';

  return jsonb_build_object(
    'queue_name', metrics.queue_name,
    'queue_depth', metrics.queue_length,
    'queue_visible_depth', metrics.queue_visible_length,
    'oldest_msg_age_sec', metrics.oldest_msg_age_sec,
    'newest_msg_age_sec', metrics.newest_msg_age_sec,
    'total_messages', metrics.total_messages,
    'scrape_time', metrics.scrape_time,
    'running_jobs', running_jobs,
    'queued_jobs', queued_jobs
  );
end;
$$;

revoke all on function public.get_pipeline_queue_metrics() from public, anon;
grant execute on function public.get_pipeline_queue_metrics() to authenticated, service_role;

do $$
begin
  alter publication supabase_realtime add table public.worker_status;
exception
  when duplicate_object then null;
end $$;

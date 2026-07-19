-- Lock SECURITY DEFINER maintenance RPCs (cron/postgres only).
-- Previously callable via PostgREST by authenticated/PUBLIC.

revoke all on function public.rollup_pipeline_daily() from public, anon, authenticated;
revoke all on function public.repair_stale_runs(interval) from public, anon, authenticated;
revoke all on function public.repair_stale_pipeline_jobs(interval) from public, anon, authenticated;

-- Queue helpers: dashboard/worker use direct DB or service_role, not JWT PostgREST.
revoke all on function public.enqueue_pipeline_job(text, jsonb) from public, anon, authenticated;
revoke all on function public.get_pipeline_queue_metrics() from public, anon, authenticated;

grant execute on function public.rollup_pipeline_daily() to postgres, service_role;
grant execute on function public.repair_stale_runs(interval) to postgres, service_role;
grant execute on function public.repair_stale_pipeline_jobs(interval) to postgres, service_role;
grant execute on function public.enqueue_pipeline_job(text, jsonb) to postgres, service_role;
grant execute on function public.get_pipeline_queue_metrics() to postgres, service_role;

alter function public.rollup_pipeline_daily() set search_path = public;
alter function public.repair_stale_runs(interval) set search_path = public;
-- Prefer empty search_path where bodies are fully qualified; keep public for legacy bodies.

-- Learning views/tables: operator console uses direct DB URL; deny PostgREST dump.
revoke select on public.lead_labels from authenticated;
revoke select on public.feature_outcomes from authenticated;
revoke select on public.lead_features from authenticated;
revoke select on public.insight_reports from authenticated;
revoke select on public.pipeline_daily_rollup from authenticated;

-- Reconcile / claim-release hot paths.
create index if not exists idx_leads_last_run_id
  on public.leads (last_run_id)
  where last_run_id is not null;

create index if not exists idx_runs_running_job
  on public.runs (job_id, started_at)
  where status = 'running';

create index if not exists idx_leads_enriching_run
  on public.leads (last_run_id)
  where lower(enrichment_status) = 'enriching';

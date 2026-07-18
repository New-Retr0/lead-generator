-- Optional/defensive: pg_cron sweep for stale pipeline jobs every 5 minutes.
-- The worker's startup/idle repair remains the primary mechanism; this only
-- covers the window when no worker is running at all.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    -- cron.schedule upserts by job name on current pg_cron versions.
    perform cron.schedule(
      'repair-stale-pipeline-jobs',
      '*/5 * * * *',
      'select public.repair_stale_pipeline_jobs()'
    );
  else
    raise notice 'pg_cron not available — skipping stale job cron (worker repair still runs)';
  end if;
exception
  when others then
    raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end $$;;

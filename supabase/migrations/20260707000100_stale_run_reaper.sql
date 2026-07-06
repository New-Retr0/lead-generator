create or replace function public.repair_stale_runs(older_than interval default '2 hours')
returns integer
language sql
security definer
set search_path = public
as $$
  with updated as (
    update public.runs
    set status = 'failed', finished_at = now()
    where status = 'running' and started_at < now() - older_than
    returning 1
  )
  select coalesce(count(*), 0)::int from updated;
$$;

select cron.schedule(
  'repair-stale-runs-hourly',
  '17 * * * *',
  $$select public.repair_stale_runs();$$
);

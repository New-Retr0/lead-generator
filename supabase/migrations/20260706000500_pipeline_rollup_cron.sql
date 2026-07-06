-- Nightly pipeline rollup + run_events retention (keep cost_events forever).
-- Fallback if cron.schedule fails: call rollup_pipeline_daily() from doctor.

create table if not exists public.pipeline_daily_rollup (
  id bigint generated always as identity primary key,
  day date not null,
  market_key text not null default '',
  category_key text not null default '',
  stage text not null default '',
  provider text not null default '',
  operation text not null default '',
  event_count bigint not null default 0,
  ran_count bigint not null default 0,
  usd double precision not null default 0,
  units double precision not null default 0,
  avg_duration_ms numeric,
  p95_duration_ms numeric,
  leads_enriched bigint not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_pipeline_daily_rollup_dims
  on public.pipeline_daily_rollup (day, market_key, category_key, stage, provider, operation);

alter table public.pipeline_daily_rollup enable row level security;

grant select on public.pipeline_daily_rollup to authenticated;

create or replace function public.rollup_pipeline_daily()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_day date := (now() at time zone 'utc')::date - 1;
begin
  insert into public.pipeline_daily_rollup (
    day, market_key, category_key, stage, provider, operation,
    event_count, ran_count, usd, units, avg_duration_ms, p95_duration_ms, leads_enriched
  )
  select
    target_day,
    coalesce(r.market_key, ''),
    coalesce(r.category_key, ''),
    coalesce(re.meta_json ->> 'stage', ''),
    '',
    '',
    count(*)::bigint,
    count(*) filter (where re.ran)::bigint,
    0::double precision,
    0::double precision,
    avg(re.duration_ms)::numeric,
    percentile_cont(0.95) within group (order by re.duration_ms)::numeric,
    0::bigint
  from public.run_events re
  join public.runs r on r.run_id = re.run_id
  where re.stage = 'stage_done'
    and re.meta_json ->> 'stage' is not null
    and re.created_at >= target_day
    and re.created_at < target_day + 1
  group by r.market_key, r.category_key, re.meta_json ->> 'stage'
  on conflict (day, market_key, category_key, stage, provider, operation) do update set
    event_count = excluded.event_count,
    ran_count = excluded.ran_count,
    avg_duration_ms = excluded.avg_duration_ms,
    p95_duration_ms = excluded.p95_duration_ms;

  insert into public.pipeline_daily_rollup (
    day, market_key, category_key, stage, provider, operation,
    event_count, ran_count, usd, units, avg_duration_ms, p95_duration_ms, leads_enriched
  )
  select
    target_day,
    coalesce(r.market_key, ''),
    coalesce(r.category_key, ''),
    coalesce(ce.meta_json ->> 'stage', ''),
    ce.provider,
    ce.operation,
    count(*)::bigint,
    count(*)::bigint,
    coalesce(sum(ce.usd), 0),
    coalesce(sum(ce.units), 0),
    avg((ce.meta_json ->> 'duration_ms')::numeric),
    percentile_cont(0.95) within group (
      order by (ce.meta_json ->> 'duration_ms')::numeric
    ),
    0::bigint
  from public.cost_events ce
  join public.runs r on r.run_id = ce.run_id
  where ce.created_at >= target_day
    and ce.created_at < target_day + 1
  group by r.market_key, r.category_key, ce.meta_json ->> 'stage', ce.provider, ce.operation
  on conflict (day, market_key, category_key, stage, provider, operation) do update set
    event_count = excluded.event_count,
    ran_count = excluded.ran_count,
    usd = excluded.usd,
    units = excluded.units,
    avg_duration_ms = excluded.avg_duration_ms,
    p95_duration_ms = excluded.p95_duration_ms;

  insert into public.pipeline_daily_rollup (
    day, market_key, category_key, stage, provider, operation,
    event_count, ran_count, usd, units, avg_duration_ms, p95_duration_ms, leads_enriched
  )
  select
    target_day,
    coalesce(r.market_key, ''),
    coalesce(r.category_key, ''),
    '',
    '',
    '',
    count(distinct r.run_id)::bigint,
    count(distinct r.run_id)::bigint,
    coalesce(sum(run_cost.usd), 0),
    coalesce(sum(run_cost.firecrawl_credits), 0),
    avg(lead_done.avg_duration_ms)::numeric,
    null::numeric,
    coalesce(sum(r.enriched_count), 0)::bigint
  from public.runs r
  left join lateral (
    select
      coalesce(sum(ce.usd), 0) as usd,
      coalesce(sum(case when ce.provider = 'firecrawl' then ce.units else 0 end), 0) as firecrawl_credits
    from public.cost_events ce
    where ce.run_id = r.run_id
  ) run_cost on true
  left join lateral (
    select avg(re.duration_ms) as avg_duration_ms
    from public.run_events re
    where re.run_id = r.run_id
      and re.stage = 'lead_done'
      and re.duration_ms is not null
  ) lead_done on true
  where r.started_at >= target_day
    and r.started_at < target_day + 1
  group by r.market_key, r.category_key
  on conflict (day, market_key, category_key, stage, provider, operation) do update set
    event_count = excluded.event_count,
    ran_count = excluded.ran_count,
    usd = excluded.usd,
    units = excluded.units,
    avg_duration_ms = excluded.avg_duration_ms,
    leads_enriched = excluded.leads_enriched;

  delete from public.run_events
  where created_at < now() - interval '90 days';
end;
$$;

grant execute on function public.rollup_pipeline_daily() to authenticated;

create extension if not exists pg_cron with schema extensions;

do $$
begin
  perform cron.schedule(
    'pipeline-daily-rollup',
    '15 9 * * *',
    $$select public.rollup_pipeline_daily()$$
  );
exception
  when others then
    raise notice 'pg_cron schedule skipped: %', sqlerrm;
end;
$$;

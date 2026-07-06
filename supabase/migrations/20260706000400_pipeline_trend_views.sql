-- Pipeline Studio historical analytics (security_invoker, last 90 days).

create view public.stage_stats_by_run
with (security_invoker = true)
as
select
  r.run_id,
  coalesce(re.meta_json ->> 'stage', re.stage) as stage,
  count(*)::bigint as event_count,
  count(*) filter (where re.ran)::bigint as ran_count,
  avg(re.duration_ms)::numeric as avg_duration_ms,
  max(re.duration_ms)::bigint as max_duration_ms,
  percentile_cont(0.95) within group (order by re.duration_ms)::numeric as p95_duration_ms,
  r.market_key,
  r.category_key,
  r.started_at
from public.run_events re
join public.runs r on r.run_id = re.run_id
where re.stage = 'stage_done'
  and re.meta_json ->> 'stage' is not null
  and re.duration_ms is not null
group by
  r.run_id,
  coalesce(re.meta_json ->> 'stage', re.stage),
  r.market_key,
  r.category_key,
  r.started_at
order by r.started_at desc, stage asc;

create view public.stage_trends_by_day
with (security_invoker = true)
as
select
  date_trunc('day', re.created_at)::date as day,
  re.meta_json ->> 'stage' as stage,
  avg(re.duration_ms)::numeric as avg_duration_ms,
  percentile_cont(0.95) within group (order by re.duration_ms)::numeric as p95_duration_ms,
  count(distinct re.run_id)::bigint as run_count,
  count(*)::bigint as event_count
from public.run_events re
where re.stage = 'stage_done'
  and re.meta_json ->> 'stage' is not null
  and re.duration_ms is not null
  and re.created_at >= now() - interval '90 days'
group by 1, 2
order by 1 asc, 2 asc;

create view public.op_trends_by_day
with (security_invoker = true)
as
select
  date_trunc('day', ce.created_at)::date as day,
  ce.provider,
  ce.operation,
  coalesce(sum(ce.usd), 0) as usd,
  coalesce(sum(ce.units), 0) as units,
  count(*)::bigint as call_count,
  avg((ce.meta_json ->> 'duration_ms')::numeric) as avg_duration_ms
from public.cost_events ce
where ce.created_at >= now() - interval '90 days'
group by 1, 2, 3
order by 1 asc, ce.provider asc, ce.operation asc;

create view public.run_efficiency_by_day
with (security_invoker = true)
as
select
  date_trunc('day', r.started_at)::date as day,
  count(distinct r.run_id)::bigint as run_count,
  coalesce(sum(r.enriched_count), 0)::bigint as leads_enriched,
  coalesce(sum(run_cost.usd), 0) as total_usd,
  case
    when coalesce(sum(r.enriched_count), 0) > 0
      then coalesce(sum(run_cost.usd), 0) / sum(r.enriched_count)
    else null
  end as usd_per_enriched_lead,
  avg(lead_done.avg_duration_ms)::numeric as avg_lead_duration_ms,
  case
    when coalesce(sum(r.enriched_count), 0) > 0
      then coalesce(sum(run_cost.firecrawl_credits), 0) / sum(r.enriched_count)
    else null
  end as firecrawl_credits_per_lead
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
where r.started_at >= now() - interval '90 days'
group by 1
order by 1 asc;

grant select on public.stage_stats_by_run to authenticated;
grant select on public.stage_trends_by_day to authenticated;
grant select on public.op_trends_by_day to authenticated;
grant select on public.run_efficiency_by_day to authenticated;

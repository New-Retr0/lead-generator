-- Per-run, per-model, per-market, and hourly cost analytics (security_invoker).

create view public.cost_by_run
with (security_invoker = true)
as
select
  r.run_id,
  r.started_at,
  r.finished_at,
  r.run_type,
  r.market_key,
  r.category_key,
  r.campaign_key,
  r.discovered_count,
  r.enriched_count,
  r.status,
  coalesce(sum(ce.usd), 0) as usd,
  coalesce(sum(case when ce.provider = 'firecrawl' then ce.units else 0 end), 0) as firecrawl_credits,
  coalesce(sum(case when ce.provider = 'browser_use' then ce.usd else 0 end), 0) as browser_use_usd,
  coalesce(sum(case when ce.provider = 'ai_gateway' then ce.usd else 0 end), 0) as ai_gateway_usd,
  coalesce(sum(case when ce.provider = 'google_places' then ce.usd else 0 end), 0) as google_places_usd,
  count(ce.id)::bigint as event_count,
  case
    when r.enriched_count > 0 then coalesce(sum(ce.usd), 0) / r.enriched_count
    else null
  end as usd_per_enriched_lead
from public.runs r
left join public.cost_events ce on ce.run_id = r.run_id
group by
  r.run_id,
  r.started_at,
  r.finished_at,
  r.run_type,
  r.market_key,
  r.category_key,
  r.campaign_key,
  r.discovered_count,
  r.enriched_count,
  r.status
order by r.started_at desc;

create view public.cost_by_model
with (security_invoker = true)
as
select
  provider,
  coalesce(model, '') as model,
  operation,
  unit_type,
  coalesce(sum(units), 0) as units,
  coalesce(sum(usd), 0) as usd,
  count(*)::bigint as event_count
from public.cost_events
group by provider, model, operation, unit_type
order by usd desc;

create view public.cost_by_market
with (security_invoker = true)
as
select
  r.market_key,
  r.category_key,
  coalesce(sum(ce.usd), 0) as usd,
  coalesce(sum(case when ce.provider = 'firecrawl' then ce.units else 0 end), 0) as firecrawl_credits,
  count(distinct r.run_id)::bigint as run_count,
  count(ce.id)::bigint as event_count
from public.cost_events ce
join public.runs r on r.run_id = ce.run_id
where ce.created_at >= now() - interval '90 days'
group by r.market_key, r.category_key
order by usd desc;

create view public.cost_by_hour
with (security_invoker = true)
as
select
  date_trunc('hour', created_at) as hour,
  coalesce(sum(usd), 0) as usd,
  coalesce(sum(case when provider = 'firecrawl' then units else 0 end), 0) as firecrawl_credits,
  count(*)::bigint as event_count
from public.cost_events
where created_at >= now() - interval '72 hours'
group by 1
order by 1;

grant select on public.cost_by_run to authenticated;
grant select on public.cost_by_model to authenticated;
grant select on public.cost_by_market to authenticated;
grant select on public.cost_by_hour to authenticated;

-- Purge retired AI Gateway cost ledger rows and drop ai_gateway_usd from
-- cost aggregation views. Totals no longer include that provider.

delete from public.cost_events
where provider = 'ai_gateway';

drop view if exists public.cost_by_day;

create view public.cost_by_day
with (security_invoker = true)
as
select
  to_char(created_at, 'YYYY-MM-DD') as date,
  coalesce(sum(usd), 0) as usd,
  coalesce(sum(case when provider = 'firecrawl' then units else 0 end), 0) as firecrawl_credits,
  coalesce(sum(case when provider = 'browser_use' then usd else 0 end), 0) as browser_use_usd,
  coalesce(sum(case when provider = 'google_places' then usd else 0 end), 0) as google_places_usd
from public.cost_events
group by 1
order by 1;

grant select on public.cost_by_day to authenticated;

drop view if exists public.cost_by_run;

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

grant select on public.cost_by_run to authenticated;

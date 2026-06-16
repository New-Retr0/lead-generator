-- Aggregation views for sales-app / dashboard cost charts (security_invoker).

create view public.cost_by_day
with (security_invoker = true)
as
select
  to_char(created_at, 'YYYY-MM-DD') as date,
  coalesce(sum(usd), 0) as usd,
  coalesce(sum(case when provider = 'firecrawl' then units else 0 end), 0) as firecrawl_credits,
  coalesce(sum(case when provider = 'browser_use' then usd else 0 end), 0) as browser_use_usd,
  coalesce(sum(case when provider = 'ai_gateway' then usd else 0 end), 0) as ai_gateway_usd,
  coalesce(sum(case when provider = 'google_places' then usd else 0 end), 0) as google_places_usd
from public.cost_events
group by 1
order by 1;

create view public.cost_by_provider
with (security_invoker = true)
as
select
  provider,
  unit_type,
  coalesce(sum(usd), 0) as usd,
  coalesce(sum(units), 0) as units,
  count(*)::bigint as event_count
from public.cost_events
group by provider, unit_type
order by usd desc;

grant select on public.cost_by_day to authenticated;
grant select on public.cost_by_provider to authenticated;

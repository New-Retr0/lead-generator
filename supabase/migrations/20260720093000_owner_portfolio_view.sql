-- Cross-county owner graph: one owner/entity -> all the parcels & leads it controls.
-- A property manager or holding entity controlling many sites is one conversation that
-- can close many exterior-cleaning contracts (the top deal-value lever under a 10%
-- commission). Substrate is already indexed (owner_records.owner_name_normalized).

-- Aggregate: one row per owner entity with its portfolio footprint.
create or replace view public.owner_portfolio_v1 as
select
    o.owner_name_normalized,
    min(o.owner_name)                                                  as owner_name,
    max(o.owner_kind)                                                  as owner_kind,
    count(distinct o.place_id)                                         as portfolio_size,
    count(distinct l.market_key)                                       as market_count,
    array_agg(distinct o.place_id)                                     as place_ids,
    array_agg(distinct l.city)    filter (where l.city is not null)    as cities,
    array_agg(distinct l.market_key) filter (where l.market_key is not null) as markets
from public.owner_records o
join public.leads l on l.place_id = o.place_id
where coalesce(o.owner_name_normalized, '') <> ''
group by o.owner_name_normalized;

-- Per-lead convenience: attach the owning entity's portfolio size + siblings to a lead,
-- so the dashboard / Partner API can rank multi-site owners to the top ("owns N sites").
create or replace view public.lead_owner_portfolio_v1 as
select
    o.place_id,
    o.owner_name_normalized,
    p.owner_name,
    p.owner_kind,
    p.portfolio_size,
    p.market_count,
    p.place_ids as sibling_place_ids
from public.owner_records o
join public.owner_portfolio_v1 p on p.owner_name_normalized = o.owner_name_normalized;

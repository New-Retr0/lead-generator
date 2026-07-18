-- Partner outcomes must not lose to sticky auto lead_outcomes created by
-- mirrorSalesFeedback → sales_feedback trigger. Prefer partner/crm over auto,
-- and skip auto-insert when a partner outcome already exists.
-- Also scope idempotency keys by route so outcome/touch/batch cannot collide.

alter table public.partner_idempotency_keys
  drop constraint if exists partner_idempotency_keys_pkey;

alter table public.partner_idempotency_keys
  add primary key (partner_key_id, idempotency_key, route);

create or replace function public.auto_lead_outcome_from_sales_feedback()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and new.status in ('Won', 'Lost', 'Bad Data')
     and not exists (
       select 1
       from public.lead_outcomes lo
       where lo.place_id = new.place_id
     )
     and not exists (
       select 1
       from public.partner_lead_outcomes plo
       where plo.place_id = new.place_id
     )
  then
    insert into public.lead_outcomes (place_id, outcome, source)
    values (
      new.place_id,
      case new.status
        when 'Won' then 'won'
        when 'Lost' then 'lost'
        when 'Bad Data' then 'bad_data'
      end,
      'auto'
    );
  end if;
  return new;
end;
$$;

-- Same shape as 20260717230000_partner_scoped_outcomes, but auto ranks below partner.
create or replace view public.lead_labels
with (security_invoker = true)
as
select
  l.place_id,
  coalesce(
    lo.outcome,
    case sf.status
      when 'Won' then 'won'
      when 'Lost' then 'lost'
      when 'Bad Data' then 'bad_data'
    end
  ) as outcome,
  lo.outcome_reason,
  lo.deal_value_usd,
  lo.quality_rating,
  lo.data_flags,
  lo.outcome_source,
  lo.decided_at,
  lo.notes as outcome_notes,
  sf.status as crm_status,
  case coalesce(
    lo.outcome,
    case sf.status
      when 'Won' then 'won'
      when 'Lost' then 'lost'
      when 'Bad Data' then 'bad_data'
    end
  )
    when 'won' then 1
    when 'lost' then 0
    when 'bad_data' then 0
    when 'no_response' then 0
    else null
  end as label_good,
  case sf.status
    when 'New' then 0
    when 'Contacted' then 1
    when 'Follow Up' then 2
    when 'Interested' then 3
    when 'Quote Sent' then 4
    when 'Won' then 5
    else null
  end as engagement_ladder,
  exists (
    select 1
    from public.lead_touches lt
    where lt.place_id = l.place_id
      and lt.result = 'dm_reached'
  ) as reached_dm
from public.leads l
join public.sales_feedback sf using (place_id)
left join lateral (
  select
    x.outcome,
    x.outcome_reason,
    x.deal_value_usd,
    x.quality_rating,
    x.data_flags,
    x.outcome_source,
    x.decided_at,
    x.notes
  from (
    select
      i.outcome,
      i.outcome_reason,
      i.deal_value_usd,
      i.quality_rating,
      i.data_flags,
      i.source as outcome_source,
      i.decided_at,
      i.notes,
      case when i.source = 'auto' then 2 else 0 end as source_rank
    from public.lead_outcomes i
    where i.place_id = l.place_id
      and i.partner_key_id is null
    union all
    select
      p.outcome,
      p.outcome_reason,
      p.deal_value_usd,
      p.quality_rating,
      p.data_flags,
      'partner_api'::text as outcome_source,
      p.decided_at,
      p.notes,
      1 as source_rank
    from public.partner_lead_outcomes p
    where p.place_id = l.place_id
  ) x
  order by
    x.source_rank asc,
    case x.outcome
      when 'won' then 0
      when 'lost' then 1
      when 'unqualified' then 2
      when 'bad_data' then 3
      else 4
    end,
    x.decided_at desc nulls last
  limit 1
) lo on true;

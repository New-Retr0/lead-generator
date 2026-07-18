-- Partner-scoped outcomes: each API key keeps its own outcome row per place.
-- Learning aggregation (lead_labels) still collapses to one preferred label per place.

create table if not exists public.partner_lead_outcomes (
  place_id text not null references public.leads (place_id) on delete cascade,
  partner_key_id uuid not null references public.partner_api_keys (id) on delete cascade,
  outcome text not null check (outcome in ('won', 'lost', 'bad_data', 'unqualified', 'no_response')),
  outcome_reason text,
  deal_value_usd double precision,
  quality_rating smallint check (quality_rating between 1 and 5),
  data_flags jsonb not null default '{}'::jsonb,
  notes text,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (place_id, partner_key_id)
);

create index if not exists idx_partner_lead_outcomes_key_updated
  on public.partner_lead_outcomes (partner_key_id, updated_at desc);

-- Backfill from any existing partner_api rows in lead_outcomes.
insert into public.partner_lead_outcomes (
  place_id,
  partner_key_id,
  outcome,
  outcome_reason,
  deal_value_usd,
  quality_rating,
  data_flags,
  notes,
  decided_at,
  created_at,
  updated_at
)
select
  lo.place_id,
  lo.partner_key_id,
  lo.outcome,
  lo.outcome_reason,
  lo.deal_value_usd,
  lo.quality_rating,
  coalesce(lo.data_flags, '{}'::jsonb),
  lo.notes,
  lo.decided_at,
  lo.created_at,
  lo.updated_at
from public.lead_outcomes lo
where lo.partner_key_id is not null
  and lo.source = 'partner_api'
on conflict (place_id, partner_key_id) do nothing;

alter table public.partner_lead_outcomes enable row level security;

drop policy if exists partner_lead_outcomes_select_authenticated on public.partner_lead_outcomes;
create policy partner_lead_outcomes_select_authenticated on public.partner_lead_outcomes
  for select to authenticated using (true);

grant select on public.partner_lead_outcomes to authenticated;
grant all on public.partner_lead_outcomes to service_role;

-- Prefer CRM/auto internal outcomes, else best partner signal (won first, then latest).
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
      0 as source_rank
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

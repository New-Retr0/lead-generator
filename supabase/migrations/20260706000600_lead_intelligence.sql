-- Lead intelligence: feature snapshots, structured outcomes/touches, insight reports,
-- unified labels view, and auto-outcome backfill from CRM status changes.

create table public.lead_features (
  id bigint generated always as identity primary key,
  place_id text not null references public.leads (place_id) on delete cascade,
  run_id text,
  feature_version integer not null default 1,
  features jsonb not null,
  snapshot_at timestamptz not null default now(),
  unique (place_id, run_id)
);

create index idx_lead_features_place on public.lead_features (place_id, snapshot_at desc);

create table public.lead_outcomes (
  place_id text primary key references public.leads (place_id) on delete cascade,
  outcome text not null check (outcome in ('won', 'lost', 'bad_data', 'unqualified', 'no_response')),
  outcome_reason text,
  deal_value_usd double precision,
  quality_rating smallint check (quality_rating between 1 and 5),
  data_flags jsonb not null default '{}'::jsonb,
  source text not null default 'crm' check (source in ('crm', 'partner_api', 'auto')),
  partner_key_id uuid references public.partner_api_keys (id),
  notes text,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.lead_touches (
  id bigint generated always as identity primary key,
  place_id text not null references public.leads (place_id) on delete cascade,
  touch_type text not null check (touch_type in ('call', 'email', 'sms', 'visit', 'other')),
  result text check (result in (
    'answered', 'voicemail', 'no_answer', 'wrong_number', 'disconnected',
    'gatekeeper', 'dm_reached', 'email_sent', 'email_bounced', 'email_replied', 'other'
  )),
  contact_name text,
  contact_phone text,
  duration_seconds integer,
  source text not null default 'crm' check (source in ('crm', 'partner_api')),
  partner_key_id uuid references public.partner_api_keys (id),
  notes text,
  meta_json jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_lead_touches_place on public.lead_touches (place_id, occurred_at desc);

create table public.insight_reports (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  sample_size integer not null,
  labeled_count integer not null,
  report_json jsonb not null,
  model_metrics jsonb
);

-- Auto-create lead_outcomes when CRM status closes and no structured outcome exists yet.

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

create trigger trg_auto_lead_outcome_from_sales_feedback
after update on public.sales_feedback
for each row
execute function public.auto_lead_outcome_from_sales_feedback();

revoke all on function public.auto_lead_outcome_from_sales_feedback() from public, anon, authenticated;

-- Unified outcome labels for analysis (lead_outcomes preferred, CRM status fallback).

create view public.lead_labels
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
  lo.source as outcome_source,
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
left join public.lead_outcomes lo using (place_id);

-- Latest feature snapshot joined to labels — insights workbench input.

create view public.feature_outcomes
with (security_invoker = true)
as
select
  lf.id as feature_id,
  lf.place_id,
  lf.run_id,
  lf.feature_version,
  lf.features,
  lf.snapshot_at,
  ll.outcome,
  ll.outcome_reason,
  ll.deal_value_usd,
  ll.quality_rating,
  ll.data_flags,
  ll.outcome_source,
  ll.decided_at,
  ll.outcome_notes,
  ll.crm_status,
  ll.label_good,
  ll.engagement_ladder,
  ll.reached_dm
from (
  select distinct on (place_id)
    id,
    place_id,
    run_id,
    feature_version,
    features,
    snapshot_at
  from public.lead_features
  order by place_id, snapshot_at desc
) lf
join public.lead_labels ll using (place_id);

-- RLS: authenticated read; writes via service role / direct connection.

alter table public.lead_features enable row level security;
alter table public.lead_outcomes enable row level security;
alter table public.lead_touches enable row level security;
alter table public.insight_reports enable row level security;

drop policy if exists lead_features_select_authenticated on public.lead_features;
create policy lead_features_select_authenticated on public.lead_features
  for select to authenticated
  using (true);

drop policy if exists lead_outcomes_select_authenticated on public.lead_outcomes;
create policy lead_outcomes_select_authenticated on public.lead_outcomes
  for select to authenticated
  using (true);

drop policy if exists lead_touches_select_authenticated on public.lead_touches;
create policy lead_touches_select_authenticated on public.lead_touches
  for select to authenticated
  using (true);

drop policy if exists insight_reports_select_authenticated on public.insight_reports;
create policy insight_reports_select_authenticated on public.insight_reports
  for select to authenticated
  using (true);

grant select on public.lead_features to authenticated;
grant select on public.lead_outcomes to authenticated;
grant select on public.lead_touches to authenticated;
grant select on public.insight_reports to authenticated;
grant select on public.lead_labels to authenticated;
grant select on public.feature_outcomes to authenticated;

grant all on public.lead_features to service_role;
grant all on public.lead_outcomes to service_role;
grant all on public.lead_touches to service_role;
grant all on public.insight_reports to service_role;

grant usage, select on sequence public.lead_features_id_seq to service_role;
grant usage, select on sequence public.lead_touches_id_seq to service_role;
grant usage, select on sequence public.insight_reports_id_seq to service_role;

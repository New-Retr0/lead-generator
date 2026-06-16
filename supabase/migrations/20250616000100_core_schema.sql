-- Core schema mirroring pallares_leads SQLite (schema v5).
-- page_cache and domain_cache stay operator-local (not in Supabase).

create table public.leads (
  place_id text primary key,
  business_name text not null,
  market_key text,
  category_key text,
  city text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_enriched_at timestamptz,
  last_run_id text,
  enrichment_status text,
  confidence text,
  source_tool text,
  csv_path text,
  profile_key text,
  enriched_json jsonb,
  credits_total integer,
  lead_score integer,
  request_id text
);

create index idx_leads_last_enriched on public.leads (last_enriched_at);
create index idx_leads_market_category on public.leads (market_key, category_key);
create index idx_leads_enrichment_status on public.leads (enrichment_status);
create index idx_leads_confidence on public.leads (confidence);
create index idx_leads_lead_score on public.leads (lead_score);
create index idx_leads_profile_key on public.leads (profile_key);

create table public.runs (
  run_id text primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  run_type text not null,
  market_key text,
  category_key text,
  campaign_key text,
  discovered_count integer not null default 0,
  skipped_known_count integer not null default 0,
  enriched_count integer not null default 0,
  status text not null default 'running'
);

create index idx_runs_started_at on public.runs (started_at);

create table public.enrichment_profiles (
  profile_key text primary key,
  property_type text not null,
  site_kind text not null,
  brand text not null,
  playbook_json jsonb not null,
  success_count integer not null default 0,
  sample_place_id text,
  first_learned_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create index idx_profiles_property_type on public.enrichment_profiles (property_type);

create table public.sales_feedback (
  place_id text primary key references public.leads (place_id) on delete cascade,
  addressed boolean not null default false,
  feedback_notes text,
  sales_ready boolean,
  status text not null default 'New',
  assigned_to text,
  updated_by uuid references auth.users (id),
  updated_by_email text,
  updated_at timestamptz not null default now(),
  constraint sales_feedback_status_chk check (
    status in (
      'New', 'Contacted', 'Follow Up', 'Interested',
      'Quote Sent', 'Won', 'Lost', 'Bad Data'
    )
  )
);

create index idx_sales_feedback_status on public.sales_feedback (status);
create index idx_sales_feedback_updated_at on public.sales_feedback (updated_at);

create table public.run_events (
  id bigint generated always as identity primary key,
  run_id text not null,
  place_id text not null references public.leads (place_id) on delete cascade,
  stage text not null,
  ran boolean not null default false,
  reason text,
  credits_est integer not null default 0,
  duration_ms integer,
  meta_json jsonb,
  created_at timestamptz not null default now()
);

create index idx_run_events_run_id on public.run_events (run_id);
create index idx_run_events_place_id on public.run_events (place_id);
create index idx_run_events_run_stage on public.run_events (run_id, stage);

create table public.cost_events (
  id bigint generated always as identity primary key,
  run_id text,
  request_id text,
  place_id text references public.leads (place_id) on delete set null,
  provider text not null,
  operation text not null,
  units double precision not null default 0,
  unit_type text not null default 'credits',
  usd double precision,
  model text,
  meta_json jsonb,
  created_at timestamptz not null default now()
);

create index idx_cost_events_run_id on public.cost_events (run_id);
create index idx_cost_events_request_id on public.cost_events (request_id);
create index idx_cost_events_provider on public.cost_events (provider);
create index idx_cost_events_place_id on public.cost_events (place_id);
create index idx_cost_events_created_at on public.cost_events (created_at);

create table public.credit_snapshots (
  id bigint generated always as identity primary key,
  provider text not null,
  remaining_credits double precision,
  used_credits double precision,
  snapshot_json jsonb,
  created_at timestamptz not null default now()
);

create index idx_credit_snapshots_provider on public.credit_snapshots (provider);

create table public.lead_requests (
  request_id text primary key,
  created_at timestamptz not null default now(),
  raw_prompt text not null,
  spec_json jsonb not null,
  status text not null default 'pending',
  leads_delivered integer not null default 0,
  credits_spent integer not null default 0,
  usd_spent double precision,
  output_path text
);

create table public.request_leads (
  request_id text not null references public.lead_requests (request_id) on delete cascade,
  place_id text not null references public.leads (place_id) on delete cascade,
  rank integer not null,
  score integer not null default 0,
  primary key (request_id, place_id)
);

create index idx_request_leads_request on public.request_leads (request_id);

create table public.lead_facts (
  id bigint generated always as identity primary key,
  place_id text not null references public.leads (place_id) on delete cascade,
  fact_kind text not null,
  value_json jsonb not null,
  source_kind text not null,
  source_url text,
  method text not null,
  quote text,
  verification text not null,
  run_id text,
  observed_at timestamptz not null default now()
);

create index idx_lead_facts_place on public.lead_facts (place_id);

create table public.owner_records (
  place_id text primary key references public.leads (place_id) on delete cascade,
  apn text,
  owner_name text not null,
  owner_name_normalized text not null,
  owner_kind text,
  sos_entity_number text,
  registered_agent text,
  principals_json jsonb,
  mailing_address text,
  broker_json jsonb,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_owner_records_name on public.owner_records (owner_name_normalized);

create table public.app_state (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into public.app_state (key, value, updated_at)
values ('schema_version', '5', now())
on conflict (key) do nothing;

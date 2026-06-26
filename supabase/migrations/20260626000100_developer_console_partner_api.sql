-- Developer console hardening, partner API support, and pipeline job queue.

create extension if not exists pgmq;

alter table public.leads
  add column if not exists updated_at timestamptz not null default now();

update public.leads
set updated_at = greatest(
  coalesce(last_enriched_at, '-infinity'::timestamptz),
  coalesce(last_seen_at, '-infinity'::timestamptz),
  coalesce(first_seen_at, '-infinity'::timestamptz)
);

create index if not exists idx_leads_updated_place
  on public.leads (updated_at, place_id);
create index if not exists idx_request_leads_place_id
  on public.request_leads (place_id);
create index if not exists idx_sales_feedback_updated_by
  on public.sales_feedback (updated_by);

create or replace function public.touch_leads_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_leads_updated_at on public.leads;
create trigger trg_touch_leads_updated_at
  before update on public.leads
  for each row execute function public.touch_leads_updated_at();

create or replace function public.touch_parent_lead_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_place_id text;
begin
  target_place_id = coalesce(new.place_id, old.place_id);
  if target_place_id is not null then
    update public.leads
    set updated_at = now()
    where place_id = target_place_id;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_touch_lead_facts_parent on public.lead_facts;
create trigger trg_touch_lead_facts_parent
  after insert or update or delete on public.lead_facts
  for each row execute function public.touch_parent_lead_updated_at();

drop trigger if exists trg_touch_owner_records_parent on public.owner_records;
create trigger trg_touch_owner_records_parent
  after insert or update or delete on public.owner_records
  for each row execute function public.touch_parent_lead_updated_at();

create table if not exists public.partner_api_keys (
  id uuid primary key default gen_random_uuid(),
  key_prefix text not null unique,
  key_hash text not null unique,
  partner_name text not null,
  scopes text[] not null default array['leads:read'],
  active boolean not null default true,
  rate_limit_per_minute integer not null default 60,
  daily_row_limit integer not null default 10000,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz
);

create table if not exists public.partner_api_requests (
  id bigint generated always as identity primary key,
  key_id uuid references public.partner_api_keys (id) on delete set null,
  endpoint text not null,
  method text not null,
  status_code integer not null,
  row_count integer not null default 0,
  duration_ms integer not null default 0,
  error_code text,
  remote_addr text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_partner_api_requests_key_created
  on public.partner_api_requests (key_id, created_at);

alter table public.partner_api_keys enable row level security;
alter table public.partner_api_requests enable row level security;

revoke all on public.partner_api_keys from anon, authenticated;
revoke all on public.partner_api_requests from anon, authenticated;
grant select, insert, update on public.partner_api_keys to service_role;
grant select, insert, update on public.partner_api_requests to service_role;
grant usage, select on sequence public.partner_api_requests_id_seq to service_role;

create or replace view public.partner_leads_v1
with (security_invoker = true)
as
select
  l.place_id as lead_id,
  l.place_id,
  case when coalesce(l.category_key, '') like 'vendor_%' then 'vendor' else 'client' end as lead_type,
  l.business_name,
  l.category_key,
  l.market_key,
  l.city,
  l.enriched_json ->> 'state' as state,
  coalesce(l.enriched_json ->> 'formatted_address', l.enriched_json ->> 'address') as address,
  l.enriched_json ->> 'website' as website,
  l.enriched_json ->> 'google_maps_url' as google_maps_url,
  coalesce(
    nullif(trim(l.enriched_json ->> 'best_contact_phone'), ''),
    nullif(trim(l.enriched_json ->> 'main_phone'), '')
  ) as primary_phone,
  l.enriched_json ->> 'best_contact_name' as best_contact_name,
  l.enriched_json ->> 'best_contact_role' as best_contact_role,
  l.enriched_json ->> 'best_contact_type' as best_contact_type,
  l.enriched_json ->> 'best_contact_email_or_form' as best_contact_email_or_form,
  l.lead_score,
  l.confidence,
  l.enriched_json ->> 'verification_level' as verification_level,
  l.enriched_json ->> 'why_this_is_a_good_fit' as why_good_fit,
  l.enriched_json ->> 'why_now' as why_now,
  l.enriched_json -> 'exterior_cleaning_need_signals' as need_signals,
  l.enriched_json -> 'sales_talking_points' as talking_points,
  l.last_enriched_at,
  l.updated_at,
  l.enriched_json -> 'site_contacts' as site_contacts,
  l.enriched_json -> 'evidence_urls' as evidence_urls,
  l.enriched_json -> 'facts' as enriched_facts,
  l.enriched_json -> 'score_breakdown' as score_breakdown,
  nullif(l.enriched_json ->> 'latitude', '')::double precision as latitude,
  nullif(l.enriched_json ->> 'longitude', '')::double precision as longitude,
  l.enriched_json ->> 'notes' as notes
from public.leads l
where l.enriched_json is not null
  and l.enrichment_status = 'enriched'
  and coalesce(l.confidence, '') <> 'Low'
  and coalesce(l.enriched_json ->> 'verification_level', '') in ('verified', 'partial')
  and coalesce(
    nullif(trim(l.enriched_json ->> 'best_contact_phone'), ''),
    nullif(trim(l.enriched_json ->> 'main_phone'), '')
  ) is not null;

revoke all on public.partner_leads_v1 from anon, authenticated;
grant select on public.partner_leads_v1 to service_role;

create table if not exists public.pipeline_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  priority integer not null default 0,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  queue_msg_id bigint,
  requested_by uuid references auth.users (id) on delete set null,
  requested_by_email text,
  command text,
  logs jsonb not null default '[]'::jsonb,
  result_json jsonb,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pipeline_jobs_kind_chk check (kind in ('doctor', 'run', 'run_campaign', 'request')),
  constraint pipeline_jobs_status_chk check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
);

create index if not exists idx_pipeline_jobs_status_created
  on public.pipeline_jobs (status, created_at desc);

alter table public.pipeline_jobs enable row level security;

drop policy if exists pipeline_jobs_select_operator on public.pipeline_jobs;
drop policy if exists pipeline_jobs_select_authenticated on public.pipeline_jobs;
create policy pipeline_jobs_select_authenticated on public.pipeline_jobs
  for select to authenticated
  using (true);

grant select on public.pipeline_jobs to authenticated;

do $$
begin
  perform pgmq.create('pipeline_jobs');
exception
  when duplicate_table then null;
  when duplicate_object then null;
end $$;

create or replace function public.enqueue_pipeline_job(job_kind text, job_payload jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  new_job_id uuid := gen_random_uuid();
  msg_id bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if job_kind not in ('doctor', 'run', 'run_campaign', 'request') then
    raise exception 'invalid pipeline job kind: %', job_kind using errcode = '22023';
  end if;

  insert into public.pipeline_jobs (
    id,
    kind,
    payload,
    requested_by,
    requested_by_email
  )
  values (
    new_job_id,
    job_kind,
    coalesce(job_payload, '{}'::jsonb),
    (select auth.uid()),
    auth.jwt() ->> 'email'
  );

  select pgmq.send(
    'pipeline_jobs',
    jsonb_build_object('job_id', new_job_id, 'kind', job_kind, 'payload', coalesce(job_payload, '{}'::jsonb))
  )
  into msg_id;

  update public.pipeline_jobs
  set queue_msg_id = msg_id,
      updated_at = now()
  where id = new_job_id;

  return new_job_id;
end;
$$;

revoke all on function public.enqueue_pipeline_job(text, jsonb) from public, anon;
grant execute on function public.enqueue_pipeline_job(text, jsonb) to authenticated;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'leads',
    'sales_feedback',
    'runs',
    'run_events',
    'enrichment_profiles',
    'cost_events',
    'credit_snapshots',
    'lead_requests',
    'request_leads',
    'lead_facts',
    'owner_records'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', tbl || '_select_authenticated', tbl);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      tbl || '_select_authenticated',
      tbl
    );
  end loop;
end $$;

drop policy if exists sales_feedback_update_authenticated on public.sales_feedback;
create policy sales_feedback_update_authenticated on public.sales_feedback
  for update to authenticated
  using (true)
  with check (true);

grant select on public.leads to authenticated;
grant select on public.runs to authenticated;
grant select on public.run_events to authenticated;
grant select on public.enrichment_profiles to authenticated;
grant select on public.cost_events to authenticated;
grant select on public.credit_snapshots to authenticated;
grant select on public.lead_requests to authenticated;
grant select on public.request_leads to authenticated;
grant select on public.lead_facts to authenticated;
grant select on public.owner_records to authenticated;
revoke all on public.sales_feedback from authenticated;
grant select on public.sales_feedback to authenticated;
grant update (status, addressed, feedback_notes) on public.sales_feedback to authenticated;
grant select on public.cost_by_day to authenticated;
grant select on public.cost_by_provider to authenticated;
grant select on public.sales_leads to authenticated;

revoke all on function public.ensure_sales_feedback() from public, anon, authenticated;
revoke all on function public.stamp_sales_feedback_actor() from public, anon, authenticated;

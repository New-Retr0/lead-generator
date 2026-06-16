-- Idempotent re-apply of authenticated read + CRM write policies.

alter table public.leads enable row level security;
alter table public.sales_feedback enable row level security;
alter table public.runs enable row level security;
alter table public.run_events enable row level security;
alter table public.enrichment_profiles enable row level security;
alter table public.cost_events enable row level security;
alter table public.credit_snapshots enable row level security;
alter table public.lead_requests enable row level security;
alter table public.request_leads enable row level security;
alter table public.lead_facts enable row level security;
alter table public.owner_records enable row level security;
alter table public.app_state enable row level security;

drop policy if exists leads_select_authenticated on public.leads;
create policy leads_select_authenticated on public.leads
  for select to authenticated using (true);

drop policy if exists sales_feedback_select_authenticated on public.sales_feedback;
create policy sales_feedback_select_authenticated on public.sales_feedback
  for select to authenticated using (true);

drop policy if exists runs_select_authenticated on public.runs;
create policy runs_select_authenticated on public.runs
  for select to authenticated using (true);

drop policy if exists run_events_select_authenticated on public.run_events;
create policy run_events_select_authenticated on public.run_events
  for select to authenticated using (true);

drop policy if exists enrichment_profiles_select_authenticated on public.enrichment_profiles;
create policy enrichment_profiles_select_authenticated on public.enrichment_profiles
  for select to authenticated using (true);

drop policy if exists cost_events_select_authenticated on public.cost_events;
create policy cost_events_select_authenticated on public.cost_events
  for select to authenticated using (true);

drop policy if exists credit_snapshots_select_authenticated on public.credit_snapshots;
create policy credit_snapshots_select_authenticated on public.credit_snapshots
  for select to authenticated using (true);

drop policy if exists lead_requests_select_authenticated on public.lead_requests;
create policy lead_requests_select_authenticated on public.lead_requests
  for select to authenticated using (true);

drop policy if exists request_leads_select_authenticated on public.request_leads;
create policy request_leads_select_authenticated on public.request_leads
  for select to authenticated using (true);

drop policy if exists lead_facts_select_authenticated on public.lead_facts;
create policy lead_facts_select_authenticated on public.lead_facts
  for select to authenticated using (true);

drop policy if exists owner_records_select_authenticated on public.owner_records;
create policy owner_records_select_authenticated on public.owner_records
  for select to authenticated using (true);

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

-- Persist management-company profile key for PM hub fan-out / same_manager related leads.
alter table public.leads
  add column if not exists mgmt_profile_key text;

create index if not exists idx_leads_mgmt_profile_key
  on public.leads (mgmt_profile_key)
  where mgmt_profile_key is not null;

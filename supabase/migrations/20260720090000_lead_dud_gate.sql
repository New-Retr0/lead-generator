-- Dud gate: remember out-of-green leads with a reason so we never re-scrape them.
-- A lead is "dud" when it can never yield a callable named decision-maker
-- (permanently/temporarily closed, no reachable path, out of geography, dead site
-- with no phone, ...). dud_at drives skip-until-reopen so discovery-time duds — which
-- have no last_enriched_at — are no longer re-admitted and re-billed every run.

alter table public.leads add column if not exists dud_reason text;
alter table public.leads add column if not exists dud_at timestamptz;

-- Partial index: dud lookups only ever scan the (small) set of stored duds.
create index if not exists idx_leads_dud_at on public.leads (dud_at) where dud_at is not null;

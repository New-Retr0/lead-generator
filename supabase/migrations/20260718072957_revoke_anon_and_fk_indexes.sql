-- Defense in depth: revoke Data API access for `anon` on operator tables/views.
-- RLS already returns 0 rows for anon, but grants were still ALL from defaults.
-- Partner surface stays service_role-only; dashboard uses the direct DB URL.

do $$
declare
  rel text;
begin
  for rel in
    select format('%I.%I', n.nspname, c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'v', 'm', 'p')
  loop
    execute format('revoke all on %s from anon', rel);
  end loop;
end $$;

-- Authenticated clients are SELECT-only via RLS policies (except sales_feedback updates).
do $$
declare
  rel text;
begin
  for rel in
    select format('%I.%I', n.nspname, c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'v', 'm', 'p')
      and c.relname <> 'sales_feedback'
  loop
    execute format(
      'revoke insert, update, delete, truncate, references, trigger on %s from authenticated',
      rel
    );
  end loop;
end $$;

-- Re-assert intentional SELECT grants for authenticated (RLS still applies).
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
grant select on public.sales_leads to authenticated;
grant select on public.cost_by_day to authenticated;
grant select on public.cost_by_provider to authenticated;
grant select on public.cost_by_run to authenticated;
grant select on public.cost_by_model to authenticated;
grant select on public.cost_by_market to authenticated;
grant select on public.cost_by_hour to authenticated;
grant select on public.stage_stats_by_run to authenticated;
grant select on public.stage_trends_by_day to authenticated;
grant select on public.op_trends_by_day to authenticated;
grant select on public.run_efficiency_by_day to authenticated;
grant select on public.lead_features to authenticated;
grant select on public.lead_outcomes to authenticated;
grant select on public.lead_touches to authenticated;
grant select on public.lead_labels to authenticated;
grant select on public.feature_outcomes to authenticated;
grant select on public.insight_reports to authenticated;
grant select on public.pipeline_jobs to authenticated;
grant select on public.pipeline_daily_rollup to authenticated;
grant select on public.worker_status to authenticated;
grant select on public.partner_lead_outcomes to authenticated;
grant select on public.app_state to authenticated;

-- sales_feedback: keep limited update columns for authenticated operators.
revoke all on public.sales_feedback from authenticated;
grant select on public.sales_feedback to authenticated;
grant update (status, addressed, feedback_notes) on public.sales_feedback to authenticated;

-- Partner API views/tables remain service_role only.
revoke all on public.partner_leads_v1 from anon, authenticated;
grant select on public.partner_leads_v1 to service_role;
revoke all on public.partner_api_keys from anon, authenticated;
revoke all on public.partner_api_requests from anon, authenticated;
revoke all on public.partner_idempotency_keys from anon, authenticated;
grant all on public.partner_api_keys to service_role;
grant all on public.partner_api_requests to service_role;
grant all on public.partner_idempotency_keys to service_role;

-- Hot-path FK indexes (dashboard + partner feedback joins).
create index if not exists idx_worker_status_current_job_id
  on public.worker_status (current_job_id)
  where current_job_id is not null;

create index if not exists idx_lead_outcomes_partner_key_id
  on public.lead_outcomes (partner_key_id)
  where partner_key_id is not null;

create index if not exists idx_lead_touches_partner_key_id
  on public.lead_touches (partner_key_id)
  where partner_key_id is not null;

-- Rename sellable inventory view: partner_leads_v1 → verified_leads_v1.
-- Keep partner_leads_v1 as a compatibility alias (same rows).
-- Expose last_worked_at alongside last_enriched_at for clearer API naming.

drop view if exists public.partner_leads_v1 cascade;

create view public.verified_leads_v1
with (security_invoker = true)
as
select
  l.place_id as lead_id,
  l.place_id,
  case when coalesce(l.category_key, '') ~ '^vendor_' then 'vendor' else 'client' end as lead_type,
  l.business_name,
  l.category_key,
  l.market_key,
  l.city,
  l.enriched_json ->> 'state' as state,
  coalesce(l.enriched_json ->> 'formatted_address', l.enriched_json ->> 'address') as address,
  l.enriched_json ->> 'website' as website,
  l.enriched_json ->> 'google_maps_url' as google_maps_url,
  case
    when public.is_local_callable_phone(l.enriched_json ->> 'best_contact_phone')
      then nullif(trim(l.enriched_json ->> 'best_contact_phone'), '')
    else null
  end as primary_phone,
  l.enriched_json ->> 'best_contact_name' as best_contact_name,
  l.enriched_json ->> 'best_contact_role' as best_contact_role,
  l.enriched_json ->> 'best_contact_type' as best_contact_type,
  l.enriched_json ->> 'best_contact_email_or_form' as best_contact_email_or_form,
  l.lead_score,
  l.confidence,
  l.enriched_json ->> 'verification_level' as verification_level,
  'verified'::text as status,
  l.enriched_json ->> 'why_now' as why_now,
  l.last_enriched_at,
  l.last_enriched_at as last_worked_at,
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
  and coalesce(l.lead_score, 0) >= 25
  and public.is_verified_decision_maker(
    l.enriched_json,
    l.enriched_json ->> 'verification_level'
  );

-- Compatibility alias for any leftover consumers.
create view public.partner_leads_v1
with (security_invoker = true)
as
select * from public.verified_leads_v1;

revoke all on public.verified_leads_v1 from anon, authenticated;
revoke all on public.partner_leads_v1 from anon, authenticated;
grant select on public.verified_leads_v1 to service_role;
grant select on public.partner_leads_v1 to service_role;

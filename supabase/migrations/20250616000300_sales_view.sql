-- Sales-facing projection (full read parity — no quality gate).

create view public.sales_leads
with (security_invoker = true)
as
select
  l.place_id,
  l.business_name,
  l.market_key,
  l.category_key,
  l.city,
  l.lead_score,
  l.confidence,
  l.enrichment_status,
  l.last_enriched_at,
  coalesce(
    l.enriched_json ->> 'main_phone',
    l.enriched_json ->> 'best_contact_phone'
  ) as phone,
  l.enriched_json ->> 'website' as website,
  l.enriched_json ->> 'google_maps_url' as maps,
  l.enriched_json ->> 'why_now' as why_now,
  l.enriched_json ->> 'why_this_is_a_good_fit' as why_good_fit,
  l.enriched_json -> 'site_contacts' as contacts,
  l.enriched_json ->> 'sales_talking_points' as talking_points,
  (coalesce(l.category_key, '') like 'vendor_%') as is_vendor,
  sf.status as crm_status,
  sf.addressed,
  sf.feedback_notes,
  sf.updated_by_email,
  sf.updated_at as crm_updated_at
from public.leads l
join public.sales_feedback sf using (place_id);

grant select on public.sales_leads to authenticated;

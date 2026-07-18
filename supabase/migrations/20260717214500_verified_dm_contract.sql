-- One callable-decision-maker predicate for pipeline, dashboard, and Partner API.

create or replace function public.normalized_us_phone_digits(value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when length(regexp_replace(coalesce(value, ''), '\D', '', 'g')) = 11
      and regexp_replace(coalesce(value, ''), '\D', '', 'g') like '1%'
    then substr(regexp_replace(value, '\D', '', 'g'), 2)
    else regexp_replace(coalesce(value, ''), '\D', '', 'g')
  end
$$;

create or replace function public.is_local_callable_phone(value text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  with phone as (
    select
      lower(trim(coalesce(value, ''))) as raw,
      public.normalized_us_phone_digits(value) as digits
  )
  select
    raw <> ''
    and raw not in (
      'not specified', 'not found', 'unknown', 'n/a', 'na', 'none',
      'unavailable', 'tbd', 'see website'
    )
    and length(digits) = 10
    and substr(digits, 1, 3) not in (
      '000', '111', '555', '800', '888', '877', '866', '855', '844', '833', '822'
    )
    and substr(digits, 4, 3) not in ('000', '555')
    and digits not in ('1234567890', '0123456789', '0000000000')
    and digits !~ '^([0-9])\1{9}$'
  from phone
$$;

create or replace function public.is_named_person(value text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(regexp_replace(trim(coalesce(value, '')), '\s+', ' ', 'g')) not in (
    '', 'john doe', 'jane doe', 'john smith', 'jane smith', 'joe bloggs',
    'test test', 'first last', 'firstname lastname', 'your name', 'full name',
    'lorem ipsum', 'n/a', 'na', 'none', 'unknown', 'example', 'contact name',
    'sample name', 'not found'
  )
$$;

create or replace function public.is_junk_contact_role(value text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when coalesce(value, '') ~* '\m(facilit(y|ies)|property[[:space:]]*manager|building[[:space:]]*manager|maintenance|operations|leasing|owner|portfolio|general[[:space:]]*manager|director)\M'
      then false
    else coalesce(value, '') ~* '\m(patient|appointment|scheduling|nurse|physician|doctor|clinical|urgent[[:space:]]*care|reception|receptionist|front[[:space:]]*desk|medical[[:space:]]*records|billing|customer[[:space:]]*service|support[[:space:]]*desk|info[[:space:]]*desk|concierge|reservation|reservations|booking)\M'
  end
$$;

create or replace function public.is_decision_maker_role(value text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select
    trim(coalesce(value, '')) <> ''
    and not public.is_junk_contact_role(value)
    and lower(value) ~ '(manager|owner|property owner|property_owner|facilities|leasing|portfolio|registered agent|registered_agent|cre broker|cre_broker|broker|principal|director|general manager|maintenance|landlord)'
$$;

create or replace function public.is_verified_decision_maker(
  enriched jsonb,
  verification_level text default null
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  with contacts as (
    select contact
    from jsonb_array_elements(
      case
        when jsonb_typeof(enriched -> 'site_contacts') = 'array'
          then enriched -> 'site_contacts'
        else '[]'::jsonb
      end
    ) as contact
  )
  select
    coalesce(verification_level, enriched ->> 'verification_level', '') = 'verified'
    and (
      (
        public.is_named_person(enriched ->> 'best_contact_name')
        and public.is_decision_maker_role(enriched ->> 'best_contact_role')
        and public.is_local_callable_phone(enriched ->> 'best_contact_phone')
      )
      or exists (
        select 1
        from contacts
        where public.is_named_person(contact ->> 'name')
          and public.is_decision_maker_role(
            coalesce(contact ->> 'label', contact ->> 'role')
          )
          and public.is_local_callable_phone(contact ->> 'phone')
      )
    )
$$;

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
  and coalesce(l.lead_score, 0) >= 25
  and public.is_verified_decision_maker(
    l.enriched_json,
    l.enriched_json ->> 'verification_level'
  );

revoke all on function public.normalized_us_phone_digits(text) from public;
revoke all on function public.is_local_callable_phone(text) from public;
revoke all on function public.is_named_person(text) from public;
revoke all on function public.is_junk_contact_role(text) from public;
revoke all on function public.is_decision_maker_role(text) from public;
revoke all on function public.is_verified_decision_maker(jsonb, text) from public;
grant execute on function public.normalized_us_phone_digits(text) to authenticated, service_role;
grant execute on function public.is_local_callable_phone(text) to authenticated, service_role;
grant execute on function public.is_named_person(text) to authenticated, service_role;
grant execute on function public.is_junk_contact_role(text) to authenticated, service_role;
grant execute on function public.is_decision_maker_role(text) to authenticated, service_role;
grant execute on function public.is_verified_decision_maker(jsonb, text) to authenticated, service_role;
revoke all on public.partner_leads_v1 from anon, authenticated;
grant select on public.partner_leads_v1 to service_role;

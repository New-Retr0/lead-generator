-- Keep is_decision_maker_role / is_junk_contact_role aligned with config/decision_roles.yaml.
-- Regenerated from the same tokens as scripts/sync_decision_roles.py (Python/TS source of truth).
-- After editing decision_roles.yaml: run sync script, then update this migration or add a follow-up.

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
  -- Synced with config/decision_roles.yaml decision_roles (+ manager substring).
  select
    trim(coalesce(value, '')) <> ''
    and not public.is_junk_contact_role(value)
    and lower(value) ~ '(manager|owner|property owner|property_owner|facilities|leasing|portfolio|registered agent|registered_agent|cre broker|cre_broker|broker|principal|director|general manager|maintenance|landlord)'
$$;

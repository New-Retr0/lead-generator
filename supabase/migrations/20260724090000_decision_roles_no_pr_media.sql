-- Align role gates with config/decision_roles.yaml:
-- reject media/PR/communications; drop bare "director" (Communications Director).

create or replace function public.is_junk_contact_role(value text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when coalesce(value, '') ~* '\m(facilit(y|ies)|property[[:space:]]*manager|building[[:space:]]*manager|maintenance|operations|leasing|owner|portfolio|general[[:space:]]*manager|facilities[[:space:]]*director|facility[[:space:]]*director|operations[[:space:]]*director|ops[[:space:]]*director)\M'
      then false
    else coalesce(value, '') ~* '\m(patient|appointment|scheduling|nurse|physician|doctor|clinical|urgent[[:space:]]*care|reception|receptionist|front[[:space:]]*desk|medical[[:space:]]*records|billing|customer[[:space:]]*service|support[[:space:]]*desk|info[[:space:]]*desk|concierge|reservations?|booking|media|pr|public[[:space:]]*relations|communications|marketing|spokesperson|publicist|public[[:space:]]*affairs|press[[:space:]]*offic|press[[:space:]]*contact|corporate[[:space:]]*communications|media[[:space:]]*relations)\M'
  end
$$;

create or replace function public.is_decision_maker_role(value text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  -- Synced with config/decision_roles.yaml (+ manager substring for store/restaurant titles).
  select
    trim(coalesce(value, '')) <> ''
    and not public.is_junk_contact_role(value)
    and lower(value) ~ '(manager|owner|property owner|property_owner|property manager|property_manager|building manager|building_manager|facilities|facilities director|facility director|operations|operations director|ops director|leasing|portfolio|registered agent|registered_agent|cre broker|cre_broker|broker|principal|general manager|maintenance|landlord)'
$$;

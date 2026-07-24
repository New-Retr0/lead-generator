-- Align SQL is_named_person with Python/dashboard Partner contract:
-- a real person name must have at least two tokens (first + last) and not be
-- a placeholder. Single-token titles like "Manager" must not pass.

create or replace function public.is_named_person(value text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select
    normalized <> ''
    and cardinality(regexp_split_to_array(normalized, '\s+')) >= 2
    and normalized not in (
      'john doe', 'jane doe', 'john smith', 'jane smith', 'joe bloggs',
      'test test', 'first last', 'firstname lastname', 'your name', 'full name',
      'lorem ipsum', 'n/a', 'na', 'none', 'unknown', 'example', 'contact name',
      'sample name', 'not found'
    )
  from (
    select lower(regexp_replace(trim(coalesce(value, '')), '\s+', ' ', 'g')) as normalized
  ) s
$$;

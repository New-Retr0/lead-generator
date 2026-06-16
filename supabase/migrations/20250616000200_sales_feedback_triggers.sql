-- Auto-create sales_feedback row when a lead is inserted.

create or replace function public.ensure_sales_feedback()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.sales_feedback (place_id)
  values (new.place_id)
  on conflict (place_id) do nothing;
  return new;
end;
$$;

create trigger trg_ensure_sales_feedback
after insert on public.leads
for each row
execute function public.ensure_sales_feedback();

-- Stamp actor on CRM updates.

create or replace function public.stamp_sales_feedback_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.updated_by_email := coalesce(auth.jwt() ->> 'email', 'operator');
  return new;
end;
$$;

create trigger trg_stamp_sales_feedback_actor
before update on public.sales_feedback
for each row
execute function public.stamp_sales_feedback_actor();

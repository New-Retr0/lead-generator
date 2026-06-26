drop policy if exists sales_feedback_update_authenticated on public.sales_feedback;

create policy sales_feedback_update_authenticated on public.sales_feedback
  for update to authenticated
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

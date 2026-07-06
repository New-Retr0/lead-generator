-- Enable Supabase Realtime for developer console live streams.

do $$
begin
  alter publication supabase_realtime add table public.pipeline_jobs;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.run_events;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.cost_events;
exception
  when duplicate_object then null;
end $$;

-- Run-level progress rows (run_started, discovery_done, heartbeat, …) have no lead yet.
alter table public.run_events
  alter column place_id drop not null;

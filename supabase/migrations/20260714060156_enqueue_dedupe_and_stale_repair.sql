-- Stale pipeline job repair.
--
-- NOTE: an earlier draft of this migration also redefined enqueue_pipeline_job
-- to dedupe identical queued jobs. That `create or replace` was removed because
-- the production database carries migrations not present in this repo
-- (20260706* / 20260707*), any of which may have already modified
-- enqueue_pipeline_job — blindly replacing it here would silently revert those
-- changes. Enqueue dedupe is a minor double-click nicety and is deferred until
-- the remote migrations are pulled into the repo and the function's current
-- definition can be reconciled. Everything below is purely additive.

-- Repair jobs orphaned by a dead worker. Called by the worker at startup and
-- on idle cycles (and optionally by pg_cron — see 20260711000300).
create or replace function public.repair_stale_pipeline_jobs(stale_after interval default interval '10 minutes')
returns integer
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  repaired integer := 0;
  job record;
  msg_id bigint;
begin
  -- Running jobs whose worker heartbeat went silent: requeue with a fresh
  -- pgmq message (attempts remain) or fail.
  for job in
    select id, attempts, max_attempts, kind, payload, queue_msg_id
    from public.pipeline_jobs
    where status = 'running'
      and coalesce(worker_heartbeat_at, started_at, updated_at) < now() - stale_after
    for update skip locked
  loop
    if job.queue_msg_id is not null then
      perform pgmq.archive('pipeline_jobs', job.queue_msg_id);
    end if;
    if coalesce(job.attempts, 0) < coalesce(job.max_attempts, 3) then
      select pgmq.send(
        'pipeline_jobs',
        jsonb_build_object('job_id', job.id, 'kind', job.kind, 'payload', job.payload)
      )
      into msg_id;
      update public.pipeline_jobs
      set status = 'queued',
          error = 'worker heartbeat lost — requeued',
          queue_msg_id = msg_id,
          finished_at = null,
          updated_at = now()
      where id = job.id;
    else
      update public.pipeline_jobs
      set status = 'failed',
          error = 'worker heartbeat lost',
          finished_at = now(),
          updated_at = now()
      where id = job.id;
    end if;
    repaired := repaired + 1;
  end loop;

  -- Queued jobs older than 24h with no queue message left: fail them.
  for job in
    select p.id
    from public.pipeline_jobs p
    where p.status = 'queued'
      and p.created_at < now() - interval '24 hours'
      and not exists (
        select 1
        from pgmq.q_pipeline_jobs q
        where (q.message ->> 'job_id') = p.id::text
      )
    for update skip locked
  loop
    update public.pipeline_jobs
    set status = 'failed',
        error = 'queued for 24h with no queue message',
        finished_at = now(),
        updated_at = now()
    where id = job.id;
    repaired := repaired + 1;
  end loop;

  return repaired;
end;
$$;

revoke all on function public.repair_stale_pipeline_jobs(interval) from public, anon, authenticated;;

create index if not exists idx_pipeline_jobs_requested_by
  on public.pipeline_jobs (requested_by);

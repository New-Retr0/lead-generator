-- Pipeline Studio telemetry backfill
-- 1) Promote stage_done.meta.stage into the stage column (and alias legacy names)
-- 2) Seed minimal lifecycle events for runs that have neither run_events nor cost_events

-- stage_done rows stored the real stage only in meta_json
UPDATE run_events
SET stage = COALESCE(NULLIF(meta_json->>'stage', ''), stage)
WHERE stage = 'stage_done'
  AND meta_json ? 'stage'
  AND COALESCE(meta_json->>'stage', '') <> '';

-- Legacy production / progress stage aliases → Studio DAG ids
UPDATE run_events SET stage = 'scrape' WHERE stage IN ('scrape_json', 'markdown', 'gateway');
UPDATE run_events SET stage = 'owner_chain' WHERE stage = 'firecrawl_agent';
UPDATE run_events SET stage = 'lead_done' WHERE stage = 'final';
UPDATE run_events SET stage = 'website_resolve' WHERE stage = 'search';
UPDATE run_events SET stage = 'tier2_search' WHERE stage = 'search_contact';
UPDATE run_events SET stage = 'source_checklist' WHERE stage LIKE 'source_check:%';
UPDATE run_events SET stage = 'discovery' WHERE stage IN ('run_started', 'discovery_done');
UPDATE run_events SET stage = 'lead_done' WHERE stage = 'run_done';

-- Minimal synthetic telemetry for shell runs with no ledger at all
INSERT INTO run_events (
  run_id, place_id, stage, ran, reason, credits_est, duration_ms, meta_json, created_at
)
SELECT
  r.run_id,
  NULL,
  'discovery',
  true,
  'backfill: run_started',
  0,
  NULL,
  jsonb_build_object(
    'event', 'run_started',
    'ts', r.started_at,
    'backfill', true,
    'market', r.market_key,
    'category', r.category_key
  ),
  COALESCE(r.started_at, now())
FROM runs r
WHERE NOT EXISTS (SELECT 1 FROM run_events e WHERE e.run_id = r.run_id)
  AND NOT EXISTS (SELECT 1 FROM cost_events c WHERE c.run_id = r.run_id);

INSERT INTO run_events (
  run_id, place_id, stage, ran, reason, credits_est, duration_ms, meta_json, created_at
)
SELECT
  r.run_id,
  NULL,
  'discovery',
  true,
  'backfill: discovery_done',
  0,
  NULL,
  jsonb_build_object(
    'event', 'discovery_done',
    'ts', COALESCE(r.finished_at, r.started_at),
    'backfill', true,
    'count', COALESCE(r.discovered_count, 0),
    'discovered', COALESCE(r.discovered_count, 0),
    'skipped_known', COALESCE(r.skipped_known_count, 0)
  ),
  COALESCE(r.finished_at, r.started_at, now())
FROM runs r
WHERE EXISTS (
  SELECT 1 FROM run_events e
  WHERE e.run_id = r.run_id
    AND e.meta_json->>'backfill' = 'true'
    AND e.meta_json->>'event' = 'run_started'
)
  AND NOT EXISTS (
    SELECT 1 FROM run_events e
    WHERE e.run_id = r.run_id
      AND e.meta_json->>'event' = 'discovery_done'
  );

INSERT INTO run_events (
  run_id, place_id, stage, ran, reason, credits_est, duration_ms, meta_json, created_at
)
SELECT
  r.run_id,
  NULL,
  'lead_done',
  true,
  'backfill: run_done',
  0,
  r.duration_ms,
  jsonb_build_object(
    'event', 'run_done',
    'ts', COALESCE(r.finished_at, r.started_at),
    'backfill', true,
    'status', r.status,
    'discovered', COALESCE(r.discovered_count, 0),
    'skipped_known', COALESCE(r.skipped_known_count, 0),
    'enriched', COALESCE(r.enriched_count, 0)
  ),
  COALESCE(r.finished_at, r.started_at, now())
FROM runs r
WHERE EXISTS (
  SELECT 1 FROM run_events e
  WHERE e.run_id = r.run_id
    AND e.meta_json->>'backfill' = 'true'
    AND e.meta_json->>'event' = 'run_started'
)
  AND NOT EXISTS (
    SELECT 1 FROM run_events e
    WHERE e.run_id = r.run_id
      AND e.meta_json->>'event' = 'run_done'
  );

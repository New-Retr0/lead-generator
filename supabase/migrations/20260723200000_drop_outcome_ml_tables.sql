-- Outcome ML deferred: stop storing feature snapshots / insight reports.
-- Keep lead_outcomes + lead_touches + lead_labels for Partner/operator feedback.
-- See docs/deferred-outcome-ml.md.

drop view if exists public.feature_outcomes;

drop table if exists public.insight_reports;
drop table if exists public.lead_features;

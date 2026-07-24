# Deferred: outcome ML / learned score

**Status:** deliberately off (2026-07-23). Do not re-enable until real closed
outcomes exist at scale.

## Why it was removed

Live inventory had ~2.2k feature snapshots, **3** Won labels, **0** structured
outcomes/touches, and `learned_score_weight=0`. Auto-ML would have been noise.

Firecrawl handles research. Operational memory that actually pays today:

- `enrichment_profiles` playbooks (franchise fast path / winning tier)
- page/domain cache + raw archive
- `skip_known` / researched-miss reopen / dud gate
- `owner_records`
- Verified = named DM + local phone (not a score)

## What was removed from the product path

- `pallares-leads insights` / `--fit-score`
- `lead_features` + `insight_reports` tables (+ `feature_outcomes` view)
- Learned-score blend in `lead_score.py`
- Settings knobs `LEARNED_SCORE_*` and `config/learned_score.yaml`
- Dashboard Learn ML theater (replaced by Playbooks)

## What stayed (feedback substrate)

- `lead_outcomes`, `partner_lead_outcomes`, `lead_touches`, `sales_feedback`
- Partner API outcome/touch endpoints
- Heuristic `lead_score` (operator ranking only; Partner eligibility ignores it)

## When to revive

1. ≥150 real labels from Partner/operator (`won` / `lost` / `bad_data` / `dm_reached`)
2. Fix before blend: train/infer scaler parity, persist logistic intercept, exclude
   circular `lead_score` / `score_*` features from the model matrix
3. Use reports to **manually** steer `campaign.yaml` / categories first; auto budget
   rewiring only after calibration looks sane

Do not auto-rewire Places queries or `search_templates.yaml` from sparse labels.

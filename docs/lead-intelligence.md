# Lead intelligence feature dictionary (FEATURE_VERSION = 1)

Flat snapshots in `lead_features.features` — numbers, booleans, and short strings only.
Raw payloads (Places reviews, Firecrawl markdown, AI prompts) live in local `data/raw_archive.db`.

## Discovery

| Key | Type | Description |
|-----|------|-------------|
| `category_key` | string | Campaign category slug |
| `market_key` | string | Market slug from `config/markets.yaml` |
| `discovery_method` | string | `text_search`, `nearby`, or `overpass` |
| `business_status` | string | Google `businessStatus` |
| `primary_type` | string | Primary Google place type |
| `google_types_count` | int | Count of Google types |
| `rating` | float | Google star rating |
| `user_rating_count` | int | Google review count |
| `price_level` | string | Google price level enum |
| `has_website` | bool | Website URI present at discovery |
| `website_kind` | string | `custom_domain`, `franchise`, `social_only`, `none` |
| `phone_source` | string | `google`, `scrape`, or `none` |
| `has_intl_phone` | bool | International phone captured |
| `osm_area_m2` | float | OSM polygon area (Overpass leads) |
| `days_open_per_week` | int | From `regularOpeningHours` |
| `open_weekends` | bool | Open Saturday or Sunday |
| `is_24h` | bool | 24-hour operation signal |
| `has_parking_lot` | bool | `parkingOptions` lot flags |
| `accepts_credit_cards` | bool | From `paymentOptions` |
| `has_editorial_summary` | bool | Google editorial blurb present |
| `newest_review_days_ago` | int | Age of newest archived review |
| `pure_service_area` | bool | No storefront / service-area business |

## Enrichment

| Key | Type | Description |
|-----|------|-------------|
| `verification_level` | string | `verified`, `partial`, `unverified` |
| `confidence` | string | `High`, `Medium`, `Low` |
| `lead_score` | int | Heuristic score 0–100 |
| `score_*` | int | Flattened `score_breakdown` components |
| `best_contact_role_rank` | int | Lower = better decision-maker role |
| `site_contacts_count` | int | Contacts on site |
| `dm_contacts_count` | int | Decision-maker-like contacts |
| `has_email` | bool | Callable email on best contact |
| `has_direct_phone` | bool | Named direct line on best contact |
| `evidence_urls_count` | int | Evidence URL count |
| `facts_count_phone/person/email` | int | Verified fact ledger counts |
| `grounding_rejections_count` | int | LLM values rejected by grounding gate |
| `profile_key` | string | Lead profile classifier key |
| `used_playbook_fastpath` | bool | Playbook short-circuit used |
| `owner_record_present` | bool | Row in `owner_records` |
| `owner_kind` | string | Owner chain entity kind |
| `principals_count` | int | Officers/principals from owner chain |
| `bbb_rating` | string | BBB registry rating if found |
| `bbb_years_in_business` | int | BBB tenure if found |
| `source_tool` | string | Enrichment stack label |
| `tier_reached` | string | Highest enrichment tier completed |

## Ops / temporal

| Key | Type | Description |
|-----|------|-------------|
| `credits_total` | int | Firecrawl credits for this run/lead |
| `usd_total` | float | Estimated USD for this run/lead |
| `enrich_duration_ms` | int | Wall time for enrichment |
| `duration_ms_*` | int | Per-stage durations when available |
| `model` | string | Optional model id (legacy; unused after Firecrawl scrape+JSON) |
| `found_dow` | int | Weekday lead first seen (0=Mon) |
| `found_hour` | int | Hour lead snapshot taken (UTC) |
| `days_first_seen_to_enriched` | int | Days since discovery date |

## Outcome learning

Labels come from `lead_labels` view (`lead_outcomes` preferred, CRM fallback).
Run `pallares-leads insights` to correlate features vs `label_good` and engagement ladder.
With ≥150 labels, `--fit-score` writes `config/learned_score.yaml` for optional score blending.

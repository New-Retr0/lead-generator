# Pallares Partner Lead API

Base URL:

```text
https://aufbppdxjybopacabsbk.supabase.co/functions/v1/partner-api/v1
```

Authenticate every non-health request with the partner key:

```http
Authorization: Bearer ppl_...
```

## Endpoints

```http
GET /health
GET /metadata
GET /leads?type=client&limit=100
GET /leads?type=vendor&updated_since=2026-06-01T00:00:00Z
GET /leads?cursor=<next_cursor>
GET /leads/{place_id}
```

`/leads` uses forward-only cursor pagination ordered by `updated_at, place_id`.
Store `page.next_cursor` and keep requesting until `page.has_more` is `false`.

## Included Fields

List responses include lead id, lead type, business/category/market/address,
website, Google Maps URL, callable phone, best contact, score, confidence,
verification level, fit/urgency copy, need signals, talking points, and
enrichment timestamps.

Detail responses include the list fields plus site contacts, evidence URLs,
grouped fact summaries, score breakdown, coordinates, and relevant notes.

## Excluded Fields

The partner API does not expose costs, credit usage, run logs, raw enriched
JSON, CRM feedback, request internals, failed developer triage, or Supabase
credentials.

## Limits

Default page size is 100 leads. Maximum page size is 500 leads. Default rate
limit is 60 requests per minute, with a 10,000-row daily budget per key.

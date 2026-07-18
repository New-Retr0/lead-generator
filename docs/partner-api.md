# Pallares Partner Lead API

Use this API to pull Pallares lead-generation data and post structured
outcomes/touches. It uses a dedicated scoped partner key.

Machine-readable spec: [`partner-api.openapi.yaml`](./partner-api.openapi.yaml)

## Base URL

```text
https://aufbppdxjybopacabsbk.supabase.co/functions/v1/partner-api/v1
```

## Authentication

**Primary:** send the partner API key on every request except `/health`:

```http
x-api-key: ppl_...
```

Compatibility alternative:

```http
Authorization: Bearer ppl_...
```

Store the key as a server-side environment variable. Do not ship it in browser
JavaScript or mobile client code.

Operators can create or rotate keys with `scripts/create_partner_api_key.py`.
The service role key is server-only; never expose it to clients.

## Error shape

Non-2xx responses use a consistent JSON envelope:

```json
{
  "error": {
    "code": "invalid_api_key",
    "message": "The partner API key is invalid."
  }
}
```

Common codes: `missing_api_key`, `invalid_api_key`, `expired_api_key`,
`rate_limited`, `daily_row_limit_exceeded`, `invalid_type`, `invalid_cursor`,
`not_found`, `missing_scope`.

Rate-limited responses include a `Retry-After` header (seconds).

## Eligibility (`partner_leads_v1`)

Only leads that pass Pallares verified-DM sales-quality gates appear in
list/detail responses. A lead is excluded when any of the following fail:

| Rule | Requirement |
|------|-------------|
| Enriched | `enrichment_status = 'enriched'` and `enriched_json` present |
| Confidence | not `Low` |
| Score | `lead_score >= 25` (the current `min_export_score`) |
| Verified DM | `verification_level = verified` **and** one grounded, non-placeholder name + decision role + local non-toll-free phone |

Partial verification and Google mainline-only phones are **not** partner-eligible.

`primary_phone` is `best_contact_phone` only when that value is a local callable
phone. Placeholder sentinels such as `Not found` are returned as `null`. It never
falls back to Google `main_phone`.

Detail requests for ineligible `place_id` values return `404 not_found`.
Use `GET /leads/{place_id}/eligibility` for a gate-by-gate debug breakdown.

### `place_id` path encoding

Place ids often look like `places/ChIJ...` (slash included). Clients should
URL-encode the path segment (`places%2FChIJ...`). The Edge Function also accepts
the unencoded multi-segment form `/leads/places/ChIJ...`.

## Endpoints

```http
GET /health
GET /metadata
GET /usage
GET /leads?type=client&limit=100
GET /leads?type=vendor&updated_since=2026-06-01T00:00:00Z
GET /leads?cursor=<next_cursor>
GET /leads/{place_id}
GET /leads/{place_id}/eligibility
```

### Feedback (`leads:feedback` scope)

Post structured outcomes and activity so Pallares can learn what makes a good lead.
Keys need `leads:feedback` in addition to (or instead of) `leads:read` for these routes.

```http
POST /leads/{place_id}/outcome
GET  /leads/{place_id}/outcome
POST /leads/{place_id}/touches
GET  /leads/{place_id}/touches?limit=50
POST /feedback/batch
```

Outcomes are **scoped per partner API key** (`partner_lead_outcomes`). One partner
cannot overwrite another partner's outcome for the same place. Learning
aggregation in `lead_labels` still collapses CRM/auto + partner signals into one
label per place for insights.

Outcome body:

```json
{
  "outcome": "won",
  "outcome_reason": "timing",
  "deal_value_usd": 12000,
  "quality_rating": 4,
  "data_flags": { "phone_correct": true, "contact_name_correct": true },
  "notes": "Closed after site walk"
}
```

Touch body:

```json
{
  "touch_type": "call",
  "result": "dm_reached",
  "contact_phone": "+15591234567",
  "duration_seconds": 240,
  "notes": "Spoke with facilities manager"
}
```

`GET .../touches` and `GET .../outcome` return only rows for the caller's API key.

### Idempotency-Key

POST `/leads/{place_id}/outcome`, `/leads/{place_id}/touches`, and
`/feedback/batch` accept an optional `Idempotency-Key` header. On first success
the response body is stored per partner key; replays with the same key return
the stored response without re-applying the write.

```http
Idempotency-Key: partner-sync-2026-07-17-batch-1
```

Batch sync (≤100 items):

```json
[
  { "place_id": "places/abc", "outcome": "lost", "outcome_reason": "no_budget" },
  { "place_id": "places/def", "touch_type": "call", "result": "voicemail" }
]
```

### Usage

```http
GET /usage
```

Returns per-key rate-limit and daily row budget consumption (`leads:read`).

### Roadmap (OpenAPI stubs only)

`POST /orders` and `POST /webhooks` are reserved in OpenAPI with
`x-stability: experimental` and are not implemented in v1.

## Pull Sync

`GET /leads` returns leads in stable cursor order by `updated_at, place_id`.
Use it like a batch sync API:

1. Call `/leads?type=client&limit=100`.
2. Store `page.next_cursor`.
3. Keep calling `/leads?cursor=<next_cursor>` until `page.has_more` is `false`.
4. On the next sync run, resume from the last stored cursor.

Use `updated_since=<ISO timestamp>` when you want to backfill or re-sync from a
specific point in time.

## Example

```bash
curl -H "x-api-key: $PALLARES_LEADS_API_KEY" \
  "https://aufbppdxjybopacabsbk.supabase.co/functions/v1/partner-api/v1/leads?type=client&limit=100"
```

```bash
curl -H "x-api-key: $PALLARES_LEADS_API_KEY" \
  "https://aufbppdxjybopacabsbk.supabase.co/functions/v1/partner-api/v1/metadata"
```

```bash
curl -H "x-api-key: $PALLARES_LEADS_API_KEY" \
  "https://aufbppdxjybopacabsbk.supabase.co/functions/v1/partner-api/v1/usage"
```

```ts
const baseUrl =
  "https://aufbppdxjybopacabsbk.supabase.co/functions/v1/partner-api/v1";

export async function pullPallaresLeads(cursor?: string) {
  const url = new URL(`${baseUrl}/leads`);
  url.searchParams.set("type", "client");
  url.searchParams.set("limit", "100");
  if (cursor) url.searchParams.set("cursor", cursor);

  const response = await fetch(url, {
    headers: {
      "x-api-key": process.env.PALLARES_LEADS_API_KEY!,
    },
  });

  if (!response.ok) {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    throw new Error(body.error?.message ?? `Pallares API failed: ${response.status}`);
  }

  return response.json();
}
```

## Lead Data

Lead list responses include the fields partners need to ingest and display leads:
lead id, lead type, business name, category, market, address, website, Google
Maps URL, callable phone, best contact, score, confidence, verification level,
fit/urgency copy and enrichment timestamps.

Lead detail responses include the list fields plus site contacts, evidence
URLs, grouped fact summaries, score breakdown, coordinates, and relevant notes.

## API Limits

The `limit` query parameter controls how many lead records the API returns per
request. If `limit` is omitted, the API returns up to 100 leads per request.
The largest allowed batch is 500 leads per request.

The default rate limit is 60 requests per minute, with a 10,000-lead daily sync
budget per key. Inspect remaining budget via `GET /usage`.

## OpenAPI

Machine-readable contract: `docs/partner-api.openapi.yaml`.

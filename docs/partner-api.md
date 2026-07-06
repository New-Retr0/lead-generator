# Pallares Partner Lead API

Use this API to pull Pallares lead-generation data into the Pallares.us
platform. The API is read-only and uses a dedicated partner key.

Machine-readable spec: [`partner-api.openapi.yaml`](./partner-api.openapi.yaml)  
Developer Console UI: `/partner-api` (OpenAPI download at `/api/partner-api/openapi`)

## Base URL

```text
https://aufbppdxjybopacabsbk.supabase.co/functions/v1/partner-api/v1
```

## Authentication

Send the partner API key on every request except `/health`:

```http
Authorization: Bearer ppl_...
```

Alternate header (same key):

```http
x-api-key: ppl_...
```

Store the key as a server-side environment variable. Do not ship it in browser
JavaScript or mobile client code.

Admins can create and revoke keys from the Developer Console (`/partner-api`) when
their Supabase user has `app_metadata.is_admin = true`. Server routes use the
service role key — never expose it to clients.

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

Only leads that pass Pallares sales-quality gates appear in list/detail responses.
A lead is excluded when any of the following fail:

| Rule | Requirement |
|------|-------------|
| Enriched | `enrichment_status = 'enriched'` and `enriched_json` present |
| Confidence | not `Low` |
| Verification | `verification_level` in `verified`, `partial` |
| Callable phone | `best_contact_phone` or `main_phone` present |

Detail requests for ineligible `place_id` values return `404 not_found`.

## Endpoints

```http
GET /health
GET /metadata
GET /leads?type=client&limit=100
GET /leads?type=vendor&updated_since=2026-06-01T00:00:00Z
GET /leads?cursor=<next_cursor>
GET /leads/{place_id}
```

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
curl -H "Authorization: Bearer $PALLARES_LEADS_API_KEY" \
  "https://aufbppdxjybopacabsbk.supabase.co/functions/v1/partner-api/v1/leads?type=client&limit=100"
```

```bash
curl -H "x-api-key: $PALLARES_LEADS_API_KEY" \
  "https://aufbppdxjybopacabsbk.supabase.co/functions/v1/partner-api/v1/metadata"
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
      Authorization: `Bearer ${process.env.PALLARES_LEADS_API_KEY}`,
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

Lead list responses include the fields Ben needs to ingest and display leads:
lead id, lead type, business name, category, market, address, website, Google
Maps URL, callable phone, best contact, score, confidence, verification level,
fit/urgency copy, need signals, talking points, and enrichment timestamps.

Lead detail responses include the list fields plus site contacts, evidence
URLs, grouped fact summaries, score breakdown, coordinates, and relevant notes.

## API Limits

The `limit` query parameter controls how many lead records the API returns per
request. If `limit` is omitted, the API returns up to 100 leads per request.
The largest allowed batch is 500 leads per request.

The default rate limit is 60 requests per minute, with a 10,000-lead daily sync
budget per key.

## Lead eligibility (`partner_leads_v1`)

Only leads that pass all of the following appear in `/leads` list or detail responses:

| Rule | Requirement |
|------|-------------|
| Enriched | `enrichment_status = enriched` and `enriched_json` present |
| Confidence | not `Low` |
| Verification | `verification_level` is `verified` or `partial` |
| Callable phone | `best_contact_phone` or `main_phone` is non-empty |

Leads that fail any rule are omitted from sync. A `404` on detail usually means the
lead exists in CRM but is not partner-eligible yet.

## Alternate auth header

In addition to `Authorization: Bearer ppl_...`, clients may send:

```http
x-api-key: ppl_...
```

## OpenAPI

Machine-readable contract: `docs/partner-api.openapi.yaml` (also served at
`/api/partner-api/openapi` on the Developer Console).

## Error shape

Failed requests return JSON:

```json
{ "error": { "code": "invalid_api_key", "message": "The partner API key is invalid." } }
```

Rate-limited responses include a `Retry-After` header (seconds).

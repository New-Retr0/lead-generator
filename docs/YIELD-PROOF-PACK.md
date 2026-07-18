# Yield proof pack

Operator checklist to prove the pipeline produces **verified decision-maker** leads
(callable named DM + local phone) at a known credit cost — not raw place volume.

See also: [docs index](./README.md), [Partner OpenAPI](./partner-api.openapi.yaml).

## Preconditions

1. Migrations applied through at least:
   - `20260717231000_partner_primary_phone_no_mainline.sql`
   - `20260717232000_partner_idempotency_keys.sql`
   - `20260717233000_decision_roles_sql_sync.sql`
2. Root `.env` has live `GOOGLE_PLACES_API_KEY`, `FIRECRAWL_API_KEY`, `SUPABASE_DB_URL`
   (template: `.env.example`).
3. `pallares-leads doctor` green for Places + Firecrawl + DB.
4. Dashboard on loopback (`cd dashboard && npm run dev:direct -- -H 127.0.0.1 -p 3000`)
   with `SUPABASE_DB_URL` in `dashboard/.env.local`.

Default CI/E2E must not burn Firecrawl or Places — paid steps below are manual / gated.

## Small paid proof run

1. Open `/launch?mode=smoke` (Execution · local — dashboard spawn only; pgmq worker is separate).
2. Run smoke sample (limit 5) or a single market×category with a tight limit.
3. On Command Center:
   - **Verified DMs** count / rate
   - **Partial inventory** counted separately (phone without atomic DM)
   - Live Firecrawl remaining / plan / concurrency
   - Credits / verified DM (prefer place-attributed Firecrawl; note caveat if fallback)
4. On `/data` default chip **Ready DMs** — every row should pass Ready (verified + atomic DM).
5. Partner API: list/detail only returns verified-DM rows; `primary_phone` is `best_contact_phone` only.

## Record

| Metric | Value |
|--------|-------|
| Date / run_id | |
| Market × category | |
| Discovered | |
| Enriched | |
| Verified DMs | |
| Partial inventory | |
| Firecrawl credits (month / attributed) | |
| Credits per verified DM | |
| Caveat flag? | |

Optional: `E2E_PAID_SMOKE=1 npm run test:e2e -- e2e/paid-smoke.spec.ts`

## Non-goals

- No treating Google mainline-only or BBB person-fact-only as Ready / Partner-eligible.

# Docs

Operator + Partner surface for **pallares-leads**. Product north star: verified named decision-maker + local callable phone.

## Start here

| Doc | When to use it |
|---|---|
| [YIELD-PROOF-PACK.md](./YIELD-PROOF-PACK.md) | Paid smoke: metrics to record after a real run |
| [GOOGLE-PLACES-SETUP.md](./GOOGLE-PLACES-SETUP.md) | Enable Places API (New) + billing |
| [partner-api.md](./partner-api.md) | Partner API guide (sync, eligibility, feedback) |
| [partner-api.openapi.yaml](./partner-api.openapi.yaml) | OpenAPI 3 contract for Partner API v1 |

## Architecture

| Doc | When to use it |
|---|---|
| [api-first-architecture.md](./api-first-architecture.md) | Partner API as sellable surface; dashboard as local console |
| [deferred-outcome-ml.md](./deferred-outcome-ml.md) | Outcome ML / learned score — deferred until real closes |

## Env

Root `.env` (see `.env.example`) holds Places, Firecrawl, and Supabase.  
Dashboard: `dashboard/.env.local` needs `SUPABASE_DB_URL` for the operator console.

# API-first product architecture

## Business model

**What we sell:** Partner API keys with scoped access to discovery, enrichment, verification, and the outcome-learning loop.

**What we do not sell:** The local `dashboard/` CRM or the Vercel `sales-app` Developer Console. Those are internal reference clients that exercise the same backend tables and Edge Function routes paying partners use.

In the AI-assisted development era, frontends are cheap to build. Durable value — and pricing power — sits in the backend: Places/Overpass discovery, Firecrawl + AI Gateway enrichment, grounding verification, owner-chain research, and the compounding dataset of features + labeled outcomes. Every partner posting structured feedback (`leads:feedback`) improves extraction, scoring, and targeting for all customers.

## Parity principle

Any lead-lifecycle capability must ship in the **Partner API** before or at the same time as any internal UI. Internal apps must not depend on private database access for anything a paying client would need.

Concretely:

- Outcomes and touches are written to `lead_outcomes` / `lead_touches` via the Edge Function **or** direct Postgres (CRM reference client).
- Partners use `POST/GET /v1/leads/{place_id}/outcome` and `POST/GET /v1/leads/{place_id}/touches` with the `leads:feedback` scope.
- Feature snapshots and insight reports are operator-facing today; per-partner insight exports are roadmap.

## Surface map

| Capability | Partner API | Internal reference |
|------------|-------------|-------------------|
| Lead list / detail / cursor sync | `GET /v1/leads`, `GET /v1/leads/{id}` (`leads:read`) | Dashboard `/leads`, CRM |
| Post outcome | `POST /v1/leads/{id}/outcome` (`leads:feedback`) | CRM status dialog |
| Read outcome | `GET /v1/leads/{id}/outcome` (`leads:feedback`) | Lead detail modal |
| Log touch | `POST /v1/leads/{id}/touches` (`leads:feedback`) | CRM “Log call” |
| Read touches | `GET /v1/leads/{id}/touches` (`leads:feedback`, key-scoped) | Lead detail timeline |
| Bulk feedback | `POST /v1/feedback/batch` (`leads:feedback`) | — |
| Metadata / health | `GET /v1/metadata`, `GET /v1/health` | — |
| Usage audit | `partner_api_requests` per key | Developer Console `/partner-api` |

## Versioning

Everything under `/v1/` is **additive-only**. Breaking changes require `/v2/`. The canonical contract is `docs/partner-api.openapi.yaml` — clients should codegen against OpenAPI.

## Roadmap (documented, not built)

- Per-partner lead pools / territories (`docs/future/multi-tenant-saas-prompt.md`)
- Webhooks for new-lead push
- Lead-request ordering via API
- Per-partner insight reports
- Usage-based billing from `partner_api_requests`

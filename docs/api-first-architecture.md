# API-first product architecture

## Business model

**What we sell:** Partner API keys with scoped access to discovery, enrichment, verification, and the outcome-learning loop.

**What we do not sell:** The local `dashboard/`. It is a developer/operator/observer console for running and diagnosing the generator, not a CRM or partner application.

Durable value sits in the backend: Places discovery, Firecrawl research, grounding verification, owner-chain research, evidence provenance, and enrichment playbooks. Partner feedback (`leads:feedback`) stays as the outcome substrate; auto-ML scoring is deferred until closes exist.

## Parity principle

Any lead-lifecycle capability must ship in the **Partner API** before or at the same time as any internal UI. Internal apps must not depend on private database access for anything a paying client would need.

Concretely:

- Outcomes and touches are written to `lead_outcomes` / `lead_touches` via the Edge Function or the local operator console.
- Partners use `POST/GET /v1/leads/{place_id}/outcome` and `POST/GET /v1/leads/{place_id}/touches` with the `leads:feedback` scope.
- Feature snapshots and insight reports are operator-facing today; per-partner insight exports are roadmap.

## Surface map

| Capability | Partner API | Internal reference |
|------------|-------------|-------------------|
| Lead list / detail / cursor sync | `GET /v1/leads`, `GET /v1/leads/{id}` (`leads:read`) | Dashboard `/data` |
| Eligibility debug | `GET /v1/leads/{id}/eligibility` (`leads:read`) | verified-DM gates |
| Post outcome | `POST /v1/leads/{id}/outcome` (`leads:feedback`, key-scoped) | Data learning-feedback form |
| Read outcome | `GET /v1/leads/{id}/outcome` (`leads:feedback`, key-scoped) | Lead detail modal |
| Log touch | `POST /v1/leads/{id}/touches` (`leads:feedback`) | Data “Log touch” form |
| Read touches | `GET /v1/leads/{id}/touches` (`leads:feedback`, key-scoped) | Lead detail timeline |
| Bulk feedback | `POST /v1/feedback/batch` (`leads:feedback`) | — |
| Metadata / health | `GET /v1/metadata`, `GET /v1/health` | — |
| Usage | `GET /v1/usage` (`leads:read`) + `partner_api_requests` | Scripted/operator review |

## Versioning

Everything under `/v1/` is **additive-only**. Breaking changes require `/v2/`. The canonical contract is `docs/partner-api.openapi.yaml` — clients should codegen against OpenAPI.

## Roadmap (documented, not built)

- Per-partner lead pools / territories
- Webhooks for new-lead push (`x-stability: experimental` stubs in OpenAPI)
- Lead-request ordering via API
- Per-partner insight reports
- Usage-based billing from `partner_api_requests`

"""Static contract checks for Partner API hardening (Phase 6).

These do not hit a live Edge Function; they lock eligibility, auth, place_id
routing, and partner-scoped outcomes into the repo sources of truth.
"""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EDGE = ROOT / "supabase" / "functions" / "partner-api" / "index.ts"
OPENAPI = ROOT / "docs" / "partner-api.openapi.yaml"
DOCS = ROOT / "docs" / "partner-api.md"
MIGRATIONS = ROOT / "supabase" / "migrations"
MIGRATION_DM = MIGRATIONS / "20260717214500_verified_dm_contract.sql"
MIGRATION_OUTCOMES = MIGRATIONS / "20260717230000_partner_scoped_outcomes.sql"
MIGRATION_PRIMARY_PHONE = MIGRATIONS / "20260717231000_partner_primary_phone_no_mainline.sql"
MIGRATION_IDEMPOTENCY = MIGRATIONS / "20260717232000_partner_idempotency_keys.sql"


def test_edge_function_serves_partner_leads_v1_only() -> None:
    src = EDGE.read_text(encoding="utf-8")
    assert '.from("partner_leads_v1")' in src
    # Must not reintroduce partial/mainline eligibility in the Edge Function.
    assert "('verified', 'partial')" not in src
    assert "verification_level in" not in src.lower()
    assert "main_phone" not in src or "Google mainline" in src
    assert "partnerPrimaryPhone" in src
    assert 'lower === "not found"' in src


def test_edge_function_parses_slashy_place_ids() -> None:
    src = EDGE.read_text(encoding="utf-8")
    assert "function parseLeadRoute" in src
    assert "LEAD_ACTIONS" in src
    assert 'join("/")' in src


def test_edge_function_scopes_outcomes_by_partner_key() -> None:
    src = EDGE.read_text(encoding="utf-8")
    assert '.from("partner_lead_outcomes")' in src
    assert 'onConflict: "place_id,partner_key_id"' in src
    assert '.eq("partner_key_id", key.id)' in src
    # Partner writes must not upsert the global lead_outcomes PK.
    assert '.from("lead_outcomes")\n    .upsert' not in src


def test_edge_function_exposes_usage_and_eligibility() -> None:
    src = EDGE.read_text(encoding="utf-8")
    assert "async function handleUsage" in src
    assert "async function handleEligibility" in src
    assert 'route[0] === "usage"' in src
    assert 'action === "eligibility"' in src
    assert "is_verified_decision_maker" in src
    assert "MIN_EXPORT_SCORE" in src


def test_edge_function_prefers_x_api_key() -> None:
    src = EDGE.read_text(encoding="utf-8")
    # x-api-key checked before Bearer.
    x_idx = src.index('req.headers.get("x-api-key")')
    bearer_idx = src.index('req.headers.get("authorization")')
    assert x_idx < bearer_idx
    assert "Prefer x-api-key" in src


def test_openapi_matches_verified_dm_eligibility() -> None:
    text = OPENAPI.read_text(encoding="utf-8")
    assert "is_verified_decision_maker" in text or "verified named decision-maker" in text.lower() or (
        "verification_level = verified" in text
    )
    assert "partial" in text.lower()  # mentioned as excluded
    assert "not` partner-eligible" in text or "not** partner-eligible" in text or "not partner-eligible" in text
    assert "/usage" in text
    assert "/leads/{place_id}/eligibility" in text
    assert "apiKeyAuth" in text
    # Primary security scheme should list apiKeyAuth first.
    security_block = text.split("security:")[-1]
    assert security_block.index("apiKeyAuth") < security_block.index("bearerAuth")
    # Must not claim partial or main_phone alone are enough.
    assert "verification_level` is `verified` or `partial`" not in text
    assert "best_contact_phone` or `main_phone`" not in text


def test_docs_document_x_api_key_primary_and_scoped_outcomes() -> None:
    text = DOCS.read_text(encoding="utf-8")
    assert text.index("x-api-key") < text.index("Authorization: Bearer")
    assert "partner_lead_outcomes" in text
    assert "/usage" in text
    assert "/eligibility" in text
    assert "URL-encode" in text or "encodeURIComponent" in text
    assert "Idempotency-Key" in text
    assert "primary_phone" in text and "best_contact_phone" in text


def test_partner_view_migration_still_verified_dm_only() -> None:
    view_sql = MIGRATION_DM.read_text(encoding="utf-8").split(
        "create or replace view public.partner_leads_v1", 1
    )[1]
    assert "public.is_verified_decision_maker" in view_sql
    assert "('verified', 'partial')" not in view_sql


def _latest_partner_leads_view_sql() -> str:
    """Return the partner_leads_v1 definition from the newest migration that creates it."""
    latest: Path | None = None
    for path in sorted(MIGRATIONS.glob("*.sql")):
        text = path.read_text(encoding="utf-8")
        if "partner_leads_v1" in text and "as primary_phone" in text:
            latest = path
    assert latest is not None, "no partner_leads_v1 migration found"
    text = latest.read_text(encoding="utf-8")
    # drop + create view (not always "create or replace")
    marker = "create view public.partner_leads_v1"
    if marker not in text:
        marker = "create or replace view public.partner_leads_v1"
    return text.split(marker, 1)[1]


def test_latest_partner_view_primary_phone_no_mainline_coalesce() -> None:
    view_sql = _latest_partner_leads_view_sql()
    assert "public.is_local_callable_phone(l.enriched_json ->> 'best_contact_phone')" in view_sql
    assert "as primary_phone" in view_sql
    assert "main_phone" not in view_sql
    assert "public.is_verified_decision_maker" in view_sql
    assert MIGRATION_PRIMARY_PHONE.exists()
    assert (
        MIGRATIONS / "20260718040000_partner_primary_phone_no_placeholder.sql"
    ).exists()


def test_edge_function_idempotency_key_support() -> None:
    src = EDGE.read_text(encoding="utf-8")
    assert "withIdempotency" in src
    assert "idempotency-key" in src
    assert "partner_idempotency_keys" in src
    assert MIGRATION_IDEMPOTENCY.exists()
    sql = MIGRATION_IDEMPOTENCY.read_text(encoding="utf-8")
    assert "create table if not exists public.partner_idempotency_keys" in sql
    assert "primary key (partner_key_id, idempotency_key)" in sql


def test_partner_scoped_outcomes_migration_keeps_learning_view() -> None:
    sql = MIGRATION_OUTCOMES.read_text(encoding="utf-8")
    assert "create table if not exists public.partner_lead_outcomes" in sql
    assert "primary key (place_id, partner_key_id)" in sql
    assert "create or replace view public.lead_labels" in sql
    assert "from public.partner_lead_outcomes" in sql

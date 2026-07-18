from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from psycopg.types.json import Jsonb

from pallares_leads.db.store import LeadStore
from pallares_leads.enrich.contact_requirements import has_atomic_named_decision_maker
from pallares_leads.resolve.verification import compute_verification_level
from pallares_leads.schemas import EnrichedLead


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "verified_dm_contract.json"
CASES: list[dict[str, Any]] = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def _enriched(payload: dict[str, Any], index: int) -> EnrichedLead:
    return EnrichedLead(
        place_id=f"verified-dm-{index}",
        business_name=f"Fixture {index}",
        formatted_address="1 Main St",
        city="Reedley",
        state="CA",
        property_type="strip_mall",
        lead_category="Strip Mall",
        investigation_status="enriched",
        **payload,
    )


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_python_verified_dm_contract(case: dict[str, Any]) -> None:
    lead = _enriched(case["lead"], CASES.index(case))
    expected_status = "Ready to call" if case["expected"] else "Needs research"
    assert lead.sales_status() == expected_status


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_verification_level_aligns_with_ready(case: dict[str, Any]) -> None:
    """Computed level matches Ready: atomic DM → verified; Ready requires that level."""
    payload = {k: v for k, v in case["lead"].items() if k != "verification_level"}
    lead = _enriched(payload, CASES.index(case))
    level = compute_verification_level(lead)
    atomic = has_atomic_named_decision_maker(lead)
    assert (level == "verified") is atomic
    lead.verification_level = level
    expected_status = "Ready to call" if atomic else "Needs research"
    assert lead.sales_status() == expected_status


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_sql_verified_dm_contract(store: LeadStore, case: dict[str, Any]) -> None:
    row = store._conn.execute(
        """
        select public.is_verified_decision_maker(%s::jsonb, %s) as ready
        """,
        (Jsonb(case["lead"]), case["lead"].get("verification_level")),
    ).fetchone()
    assert row is not None
    actual = row["ready"] if isinstance(row, dict) else row[0]
    assert actual is case["expected"]


def test_partner_view_uses_verified_dm_and_score_gate() -> None:
    migrations = Path(__file__).parents[1] / "supabase" / "migrations"
    latest: Path | None = None
    for path in sorted(migrations.glob("*.sql")):
        text = path.read_text(encoding="utf-8")
        if "partner_leads_v1" in text and "as primary_phone" in text:
            latest = path
    assert latest is not None
    text = latest.read_text(encoding="utf-8")
    marker = "create view public.partner_leads_v1"
    if marker not in text:
        marker = "create or replace view public.partner_leads_v1"
    view_sql = text.split(marker, 1)[1]
    assert "public.is_verified_decision_maker" in view_sql
    assert "coalesce(l.lead_score, 0) >= 25" in view_sql
    assert "('verified', 'partial')" not in view_sql
    assert "main_phone" not in view_sql

from __future__ import annotations

from pathlib import Path

import pytest

from pallares_leads.db.store import LeadStore
from pallares_leads.schemas import Confidence, EnrichedLead, InvestigationStatus, RawLead


def _enriched(place_id: str = "places/x") -> EnrichedLead:
    raw = RawLead(
        place_id=place_id,
        business_name="Test",
        formatted_address="123 Main",
        city="Reedley",
        state="CA",
        property_type="gas_station",
        lead_category="Gas Station",
    )
    return EnrichedLead(
        **raw.model_dump(),
        confidence=Confidence.MEDIUM,
        investigation_status=InvestigationStatus.ENRICHED,
        source_tool="test",
        best_contact_phone="(559) 638-0100",
    )


@pytest.fixture
def store(tmp_path: Path) -> LeadStore:
    db = LeadStore(tmp_path / "test.db")
    yield db
    db.close()


def test_enriched_json_roundtrip(store: LeadStore) -> None:
    lead = _enriched("places/roundtrip")
    store.upsert_enriched(
        lead,
        market_key="reedley",
        category_key="gas_station",
        run_id="r1",
    )
    loaded = store.get_enriched_lead("places/roundtrip")
    assert loaded is not None
    assert loaded.best_contact_phone == "(559) 638-0100"
    assert loaded.property_type == "gas_station"


def test_run_events_and_report(store: LeadStore) -> None:
    run_id = store.start_run(run_type="test", market_key="reedley", category_key="gas")
    store.record_run_event(
        run_id=run_id,
        place_id="places/a",
        stage="scrape_json",
        ran=True,
        credits_est=5,
    )
    store.commit_events()
    store.finish_run(run_id, discovered_count=1, skipped_known_count=0, enriched_count=1)
    report = store.run_report(run_id)
    assert report["credits_est_total"] == 5
    assert "scrape_json" in report["by_stage"]


def test_domain_cache(store: LeadStore) -> None:
    assert store.get_domain_cache("example.com") is None
    store.set_domain_cache("example.com", True)
    assert store.get_domain_cache("example.com") is True


def test_sales_feedback(store: LeadStore) -> None:
    store.upsert_sales_feedback(
        "places/a",
        addressed=True,
        feedback_notes="Called — interested",
        sales_ready=True,
    )
    rows = store.list_sales_feedback()
    assert len(rows) == 1
    assert rows[0]["addressed"] == 1

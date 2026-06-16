from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from pallares_leads.db.store import LeadStore
from pallares_leads.schemas import Confidence, EnrichedLead, InvestigationStatus, RawLead


def _raw(place_id: str = "places/abc") -> RawLead:
    return RawLead(
        place_id=place_id,
        business_name="Test Gas",
        formatted_address="123 Main",
        city="Reedley",
        state="CA",
        property_type="gas_station",
        lead_category="Gas Station",
        market_key="reedley",
    )


def _enriched(place_id: str = "places/abc") -> EnrichedLead:
    return EnrichedLead(
        **_raw(place_id).model_dump(),
        confidence=Confidence.MEDIUM,
        investigation_status=InvestigationStatus.ENRICHED,
        source_tool="google_places+firecrawl_extract",
    )


def test_should_skip_unknown_lead(store: LeadStore) -> None:
    assert (
        store.should_skip(
            "places/new", skip_known=True, force_refresh=False, refresh_after_days=None
        )
        is False
    )


def test_should_skip_after_enrichment(store: LeadStore) -> None:
    store.upsert_enriched(
        _enriched(), market_key="reedley", category_key="gas_station", run_id="r1"
    )
    assert (
        store.should_skip(
            "places/abc", skip_known=True, force_refresh=False, refresh_after_days=None
        )
        is True
    )


def test_force_refresh_bypasses_skip(store: LeadStore) -> None:
    store.upsert_enriched(
        _enriched(), market_key="reedley", category_key="gas_station", run_id="r1"
    )
    assert (
        store.should_skip(
            "places/abc", skip_known=True, force_refresh=True, refresh_after_days=None
        )
        is False
    )


def test_refresh_after_days(store: LeadStore) -> None:
    store.upsert_enriched(
        _enriched(), market_key="reedley", category_key="gas_station", run_id="r1"
    )
    old = (datetime.now(tz=UTC) - timedelta(days=60)).isoformat()
    store._conn.execute(
        "UPDATE leads SET last_enriched_at = ? WHERE place_id = ?",
        (old, "places/abc"),
    )
    store._conn.commit()
    assert (
        store.should_skip("places/abc", skip_known=True, force_refresh=False, refresh_after_days=30)
        is False
    )
    assert (
        store.should_skip("places/abc", skip_known=True, force_refresh=False, refresh_after_days=90)
        is True
    )


def test_filter_new_leads(store: LeadStore) -> None:
    store.upsert_enriched(
        _enriched("places/a"), market_key="reedley", category_key="gas_station", run_id="r1"
    )
    leads = [_raw("places/a"), _raw("places/b")]
    kept, skipped = store.filter_new_leads(
        leads, skip_known=True, force_refresh=False, refresh_after_days=None
    )
    assert skipped == 1
    assert len(kept) == 1
    assert kept[0].place_id == "places/b"


def test_touch_discovered_does_not_block_enrichment(store: LeadStore) -> None:
    store.touch_discovered(_raw(), market_key="reedley", category_key="gas_station", run_id="r1")
    assert (
        store.should_skip(
            "places/abc", skip_known=True, force_refresh=False, refresh_after_days=None
        )
        is False
    )


def test_run_log(store: LeadStore) -> None:
    run_id = store.start_run(run_type="market", market_key="reedley", category_key="gas_station")
    store.finish_run(run_id, discovered_count=5, skipped_known_count=2, enriched_count=3)
    runs = store.recent_runs(limit=1)
    assert runs[0]["discovered_count"] == 5
    assert runs[0]["skipped_known_count"] == 2
    assert runs[0]["enriched_count"] == 3


def test_record_and_get_playbook(store: LeadStore) -> None:
    store.record_profile_outcome(
        "gas_station:corporate_locator:shell",
        property_type="gas_station",
        site_kind="corporate_locator",
        brand="shell",
        playbook_update={
            "trust_google_phone": True,
            "skip_firecrawl": True,
        },
        place_id="places/shell-1",
    )
    data = store.get_playbook("gas_station:corporate_locator:shell")
    assert data is not None
    assert data["trust_google_phone"] is True
    assert data["success_count"] == 1

    store.record_profile_outcome(
        "gas_station:corporate_locator:shell",
        property_type="gas_station",
        site_kind="corporate_locator",
        brand="shell",
        playbook_update={"trust_google_phone": True},
        place_id="places/shell-2",
    )
    data = store.get_playbook("gas_station:corporate_locator:shell")
    assert data["success_count"] == 2
    assert store.count_profiles() == 1


def test_concurrent_record_cost_events(store: LeadStore) -> None:
    import threading

    expected = 8 * 25

    def worker() -> None:
        for _ in range(25):
            store.record_cost_event(
                provider="firecrawl",
                operation="scrape",
                units=1,
                usd=0.005,
            )

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    store.commit_cost_events()
    assert store.total_firecrawl_credits() == expected

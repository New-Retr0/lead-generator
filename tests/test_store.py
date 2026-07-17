from __future__ import annotations

from datetime import UTC, datetime, timedelta

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
    raw = _raw(place_id="places/touch-only-discovered")
    store.touch_discovered(raw, market_key="reedley", category_key="gas_station", run_id="r1")
    assert (
        store.should_skip(
            raw.place_id, skip_known=True, force_refresh=False, refresh_after_days=None
        )
        is False
    )


def test_progress_event_can_reference_touched_lead(store: LeadStore) -> None:
    raw = _raw(place_id="places/progress-touched")
    run_id = store.start_run(run_type="market", market_key="reedley", category_key="gas_station")
    store.touch_discovered(raw, market_key="reedley", category_key="gas_station", run_id=run_id)
    store.record_progress_event(
        run_id=run_id,
        event="lead_started",
        ts="2026-01-01T00:00:00+00:00",
        place_id=raw.place_id,
        business=raw.business_name,
    )
    events = store.run_events_for_run(run_id)
    assert any(event["stage"] == "lead_started" for event in events)


def test_run_log(store: LeadStore) -> None:
    run_id = store.start_run(run_type="market", market_key="reedley", category_key="gas_station")
    store.finish_run(run_id, discovered_count=5, skipped_known_count=2, enriched_count=3)
    runs = store.recent_runs(limit=1)
    assert runs[0]["discovered_count"] == 5
    assert runs[0]["skipped_known_count"] == 2
    assert runs[0]["enriched_count"] == 3


def test_record_and_get_playbook(store: LeadStore) -> None:
    profile_key = "gas_station:corporate_locator:shell-pytest-isolated"
    store.record_profile_outcome(
        profile_key,
        property_type="gas_station",
        site_kind="corporate_locator",
        brand="shell",
        playbook_update={
            "trust_google_phone": True,
            "skip_firecrawl": True,
        },
        place_id="places/shell-pytest-isolated",
    )
    data = store.get_playbook(profile_key)
    assert data is not None
    assert data["trust_google_phone"] is True
    assert data["success_count"] >= 1

    store.record_profile_outcome(
        profile_key,
        property_type="gas_station",
        site_kind="corporate_locator",
        brand="shell",
        playbook_update={"trust_google_phone": True},
        place_id="places/shell-pytest-isolated-2",
    )
    data = store.get_playbook(profile_key)
    assert data["success_count"] >= 2
    assert store.count_profiles() >= 1


def test_concurrent_record_cost_events(store: LeadStore) -> None:
    import threading
    import uuid

    run_id = f"concurrent-{uuid.uuid4().hex}"
    expected = 8 * 25

    def worker() -> None:
        for _ in range(25):
            store.record_cost_event(
                provider="firecrawl",
                operation="scrape",
                units=1,
                usd=0.005,
                run_id=run_id,
            )

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    store.commit_cost_events()
    assert store.run_credits_total(run_id) == expected

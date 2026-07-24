from __future__ import annotations

from datetime import UTC, datetime, timedelta

from pallares_leads.db.store import LeadStore
from pallares_leads.schemas import Confidence, EnrichedLead, InvestigationStatus, RawLead, SiteContact


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
    """Quality-complete enriched lead (verified named DM) so skip_known can retain it."""
    return EnrichedLead(
        **_raw(place_id).model_dump(),
        confidence=Confidence.MEDIUM,
        investigation_status=InvestigationStatus.ENRICHED,
        source_tool="google_places+firecrawl_extract",
        verification_level="verified",
        best_contact_name="Pat Manager",
        best_contact_role="Facilities Manager",
        best_contact_phone="(559) 555-0100",
        site_contacts=[
            SiteContact(
                label="Facilities Manager",
                name="Pat Manager",
                phone="(559) 555-0100",
                verification="verified",
            )
        ],
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


def test_studio_stage_name_aliases() -> None:
    assert LeadStore._studio_stage_name("stage_done", {"stage": "scrape_json"}) == "scrape"
    assert LeadStore._studio_stage_name("stage_done", {"stage": "firecrawl_agent"}) == "owner_chain"
    assert LeadStore._studio_stage_name("run_started", None) == "discovery"
    assert LeadStore._studio_stage_name("lead_started", None) == "lead_started"


def test_run_log(store: LeadStore) -> None:
    run_id = store.start_run(run_type="market", market_key="reedley", category_key="gas_station")
    store.finish_run(run_id, discovered_count=5, skipped_known_count=2, enriched_count=3)
    runs = store.recent_runs(limit=1)
    assert runs[0]["discovered_count"] == 5
    assert runs[0]["skipped_known_count"] == 2
    assert runs[0]["enriched_count"] == 3


def test_finish_run_writes_stop_reason(store: LeadStore) -> None:
    run_id = store.start_run(
        run_type="market",
        market_key="reedley",
        category_key="gas_station",
        job_id="job-obs-1",
    )
    store.finish_run(
        run_id,
        discovered_count=0,
        skipped_known_count=0,
        enriched_count=0,
        status="completed",
        stop_reason="empty_discovery",
        duration_ms=42,
        verified_dm_count=0,
    )
    row = store._conn.execute(
        """
        SELECT stop_reason, duration_ms, verified_dm_count, job_id
        FROM runs WHERE run_id = ?
        """,
        (run_id,),
    ).fetchone()
    assert row is not None
    assert row["stop_reason"] == "empty_discovery"
    assert int(row["duration_ms"]) == 42
    assert int(row["verified_dm_count"]) == 0
    assert row["job_id"] == "job-obs-1"


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


def test_skip_known_requires_quality_complete(store: LeadStore) -> None:
    """Non-CRE partial enrichments are not skipped forever under skip_known."""
    raw = _raw(place_id="places/partial-quality")
    lead = EnrichedLead.model_validate(raw.model_dump())
    lead.investigation_status = InvestigationStatus.ENRICHED
    lead.verification_level = "partial"
    lead.main_phone = "(559) 555-0100"
    store.upsert_enriched(
        lead,
        market_key="reedley",
        category_key="gas_station",
        run_id="r-quality",
        lead_score=10,
    )
    assert (
        store.should_skip(
            raw.place_id, skip_known=True, force_refresh=False, refresh_after_days=None
        )
        is False
    )


def test_cre_partial_without_named_dm_is_researched_miss(store: LeadStore) -> None:
    """CRE with a phone but no atomic named DM must not re-burn under skip_known."""
    raw = RawLead(
        place_id="places/cre-partial-miss",
        business_name="Reedley Plaza",
        formatted_address="100 Main",
        city="Reedley",
        state="CA",
        property_type="strip_mall",
        lead_category="Strip Mall",
        market_key="reedley",
    )
    lead = EnrichedLead.model_validate(raw.model_dump())
    lead.investigation_status = InvestigationStatus.ENRICHED
    lead.verification_level = "partial"
    lead.main_phone = "(559) 555-0100"
    store.upsert_enriched(
        lead,
        market_key="reedley",
        category_key="strip_mall",
        run_id="r-cre-miss",
        lead_score=10,
    )
    assert (
        store.should_skip(
            raw.place_id, skip_known=True, force_refresh=False, refresh_after_days=None
        )
        is True
    )


def test_researched_miss_skipped_until_reopen(store: LeadStore) -> None:
    """SKIPPED researched misses block re-spend until researched_miss_reopen_days."""
    raw = _raw(place_id="places/researched-miss")
    lead = EnrichedLead.model_validate(raw.model_dump())
    lead.investigation_status = InvestigationStatus.SKIPPED
    lead.verification_level = "unverified"
    lead.notes = "researched_miss: no verified named decision-maker"
    store.upsert_enriched(
        lead,
        market_key="reedley",
        category_key="industrial_warehouse",
        run_id="r-miss",
        lead_score=36,
    )
    row = store.get_lead_row(raw.place_id)
    assert row is not None
    assert row.get("last_enriched_at")
    assert (
        store.should_skip(
            raw.place_id, skip_known=True, force_refresh=False, refresh_after_days=None
        )
        is True
    )
    assert (
        store.should_skip(
            raw.place_id, skip_known=True, force_refresh=True, refresh_after_days=None
        )
        is False
    )

    stale = datetime.now(tz=UTC) - timedelta(days=91)
    store._conn.execute(
        "UPDATE leads SET last_enriched_at = ? WHERE place_id = ?",
        (stale.isoformat(), raw.place_id),
    )
    assert (
        store.should_skip(
            raw.place_id, skip_known=True, force_refresh=False, refresh_after_days=None
        )
        is False
    )


def test_historical_unverified_enriched_treated_as_miss(store: LeadStore) -> None:
    raw = _raw(place_id="places/old-triage")
    lead = EnrichedLead.model_validate(raw.model_dump())
    lead.investigation_status = InvestigationStatus.ENRICHED
    lead.verification_level = "unverified"
    store.upsert_enriched(
        lead,
        market_key="reedley",
        category_key="strip_mall",
        run_id="r-old",
        lead_score=40,
    )
    assert (
        store.should_skip(
            raw.place_id, skip_known=True, force_refresh=False, refresh_after_days=None
        )
        is True
    )


def test_claim_place_for_enrichment(store: LeadStore) -> None:
    run_id = store.start_run(
        run_type="market", market_key="reedley", category_key="strip_mall"
    )
    raw = _raw(place_id="places/claim-me")
    store.touch_discovered(
        raw, market_key="reedley", category_key="strip_mall", run_id=run_id
    )
    assert store.claim_place_for_enrichment(raw.place_id, run_id=run_id) is True
    # Same-run parallel workers must also lose once claimed.
    assert store.claim_place_for_enrichment(raw.place_id, run_id=run_id) is False
    run_id_2 = store.start_run(
        run_type="market", market_key="reedley", category_key="strip_mall"
    )
    assert store.claim_place_for_enrichment(raw.place_id, run_id=run_id_2) is False


def test_claim_place_missing_row_returns_false(store: LeadStore) -> None:
    # Must not "win" without an atomic UPDATE — parallel workers would double-spend.
    run_id = store.start_run(
        run_type="market", market_key="reedley", category_key="strip_mall"
    )
    assert store.claim_place_for_enrichment("places/never-touched", run_id=run_id) is False


def test_claim_place_refuses_after_run_terminal(store: LeadStore) -> None:
    """Zombie pool workers must not re-stick enriching after finish_run."""
    run_id = store.start_run(
        run_type="market", market_key="reedley", category_key="strip_mall"
    )
    raw = _raw(place_id="places/zombie-claim")
    store.touch_discovered(
        raw, market_key="reedley", category_key="strip_mall", run_id=run_id
    )
    assert store.claim_place_for_enrichment(raw.place_id, run_id=run_id) is True
    store.finish_run(
        run_id,
        discovered_count=1,
        skipped_known_count=0,
        enriched_count=0,
        status="completed",
    )
    row = store._conn.execute(
        "SELECT enrichment_status FROM leads WHERE place_id = ?",
        (raw.place_id,),
    ).fetchone()
    assert row is not None
    assert str(row["enrichment_status"]).lower() != "enriching"
    assert store.claim_place_for_enrichment(raw.place_id, run_id=run_id) is False


def test_finish_run_releases_enriching_claims(store: LeadStore) -> None:
    run_id = store.start_run(
        run_type="market", market_key="reedley", category_key="strip_mall"
    )
    raw = _raw(place_id="places/claim-release")
    store.touch_discovered(
        raw, market_key="reedley", category_key="strip_mall", run_id=run_id
    )
    assert store.claim_place_for_enrichment(raw.place_id, run_id=run_id) is True
    store.finish_run(
        run_id,
        discovered_count=1,
        skipped_known_count=0,
        enriched_count=0,
        status="failed",
        stop_reason="exception",
    )
    row = store._conn.execute(
        "SELECT enrichment_status FROM leads WHERE place_id = ?",
        (raw.place_id,),
    ).fetchone()
    assert row is not None
    assert row["enrichment_status"] == "partial"


def test_finish_run_does_not_clobber_terminal_status(store: LeadStore) -> None:
    run_id = store.start_run(
        run_type="market",
        market_key="reedley",
        category_key="strip_mall",
        job_id="job-terminal-race",
    )
    store.finish_run(
        run_id,
        discovered_count=1,
        skipped_known_count=0,
        enriched_count=0,
        status="cancelled",
        stop_reason="cancelled",
    )
    # Late CLI completion must not resurrect a cancelled/repaired row.
    store.finish_run(
        run_id,
        discovered_count=99,
        skipped_known_count=0,
        enriched_count=99,
        status="completed",
    )
    row = store._conn.execute(
        "SELECT status, discovered_count, enriched_count FROM runs WHERE run_id = ?",
        (run_id,),
    ).fetchone()
    assert row is not None
    assert row["status"] == "cancelled"
    assert int(row["discovered_count"]) == 1
    assert int(row["enriched_count"]) == 0


def test_close_orphaned_job_runs_and_update_counters_gate(store: LeadStore) -> None:
    run_id = store.start_run(
        run_type="market",
        market_key="reedley",
        category_key="strip_mall",
        job_id="job-orphan-1",
    )
    raw = _raw(place_id="places/orphan-claim")
    store.touch_discovered(
        raw, market_key="reedley", category_key="strip_mall", run_id=run_id
    )
    assert store.claim_place_for_enrichment(raw.place_id, run_id=run_id) is True
    store.update_run_counters(run_id, discovered_count=3, enriched_count=1)
    closed = store.close_orphaned_job_runs("job-orphan-1")
    assert closed == 1
    # Counters must not apply after the run is terminal.
    store.update_run_counters(run_id, discovered_count=99, enriched_count=99)
    row = store._conn.execute(
        "SELECT status, stop_reason, discovered_count, enriched_count FROM runs WHERE run_id = ?",
        (run_id,),
    ).fetchone()
    assert row is not None
    assert row["status"] == "failed"
    assert row["stop_reason"] == "orphaned"
    assert int(row["discovered_count"]) == 3
    assert int(row["enriched_count"]) == 1
    lead = store._conn.execute(
        "SELECT enrichment_status FROM leads WHERE place_id = ?",
        (raw.place_id,),
    ).fetchone()
    assert lead is not None
    assert lead["enrichment_status"] == "partial"

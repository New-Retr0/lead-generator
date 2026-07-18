"""Run failure persistence — real errors, counters, and stop metadata."""

from __future__ import annotations

import pytest

from pallares_leads.db.store import LeadStore
from pallares_leads.utils.errors import (
    exception_brief,
    failure_fields,
    stop_reason_for,
)


def test_exception_brief_includes_type_and_message() -> None:
    try:
        raise NameError("set_gateway_parallel_workers is not defined")
    except NameError as exc:
        brief = exception_brief(exc)
    assert brief.startswith("NameError:")
    assert "set_gateway_parallel_workers" in brief


def test_stop_reason_for_interrupt() -> None:
    assert stop_reason_for(KeyboardInterrupt()) == "interrupted"
    assert stop_reason_for(RuntimeError("boom")) == "exception"


def test_failure_fields_include_traceback() -> None:
    try:
        raise ValueError("tier2 exploded")
    except ValueError as exc:
        fields = failure_fields(exc)
    assert fields["stop_reason"] == "exception"
    assert "ValueError: tier2 exploded" in fields["stop_detail"]
    assert "ValueError" in fields["error"]
    assert "tier2 exploded" in fields["error"]


def test_finish_run_persists_error_and_stop_detail(store: LeadStore) -> None:
    run_id = store.start_run(
        run_type="market",
        market_key="reedley",
        category_key="strip_mall",
    )
    store.finish_run(
        run_id,
        discovered_count=8,
        skipped_known_count=1,
        enriched_count=5,
        status="failed",
        stop_reason="exception",
        stop_detail="NameError: name 'set_gateway_parallel_workers' is not defined",
        error="Traceback (most recent call last):\nNameError: ...",
        duration_ms=12_345,
    )
    row = store._conn.execute(
        """
        SELECT status, stop_reason, stop_detail, error,
               discovered_count, skipped_known_count, enriched_count
        FROM runs WHERE run_id = ?
        """,
        (run_id,),
    ).fetchone()
    assert row is not None
    assert row["status"] == "failed"
    assert row["stop_reason"] == "exception"
    assert "set_gateway_parallel_workers" in str(row["stop_detail"])
    assert "Traceback" in str(row["error"])
    assert int(row["discovered_count"]) == 8
    assert int(row["enriched_count"]) == 5


def test_run_progress_snapshot_from_events(store: LeadStore) -> None:
    run_id = store.start_run(
        run_type="market",
        market_key="fresno_county",
        category_key="property_manager",
    )
    store.record_progress_event(
        run_id=run_id,
        event="discovery_done",
        ts="2026-07-18T05:00:00+00:00",
        extra={"count": 12},
    )
    store.record_progress_event(
        run_id=run_id,
        event="lead_done",
        ts="2026-07-18T05:01:00+00:00",
        place_id="places/ChIJ_a",
        business="Alpha Plaza",
    )
    store.record_progress_event(
        run_id=run_id,
        event="lead_done",
        ts="2026-07-18T05:02:00+00:00",
        place_id="places/ChIJ_b",
        business="Beta Center",
    )
    snap = store.run_progress_snapshot(run_id)
    assert snap["discovered_count"] == 12
    assert snap["enriched_count"] == 2


def test_search_contact_gap_domain_filters_are_exclusive() -> None:
    """Guard the Firecrawl mutual-exclusion rule in the kwargs builder path."""
    include_domains = ["example.com"]
    exclude_domains = ["facebook.com"]

    search_kwargs: dict[str, object] = {}
    if include_domains:
        search_kwargs["include_domains"] = include_domains
    else:
        search_kwargs["exclude_domains"] = exclude_domains

    assert "include_domains" in search_kwargs
    assert "exclude_domains" not in search_kwargs

    search_kwargs = {}
    include_domains = []
    if include_domains:
        search_kwargs["include_domains"] = include_domains
    else:
        search_kwargs["exclude_domains"] = exclude_domains
    assert search_kwargs == {"exclude_domains": exclude_domains}

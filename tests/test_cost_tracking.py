from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from pallares_leads.costs import load_pricing, usd_for
from pallares_leads.db.store import SCHEMA_VERSION, LeadStore


def test_schema_version_migrated(store: LeadStore) -> None:
    assert store.get_app_state("schema_version") == str(SCHEMA_VERSION)


def test_record_cost_event_and_summary(store: LeadStore) -> None:
    from helpers import ensure_lead

    ensure_lead(store, "places/abc")
    store.record_cost_event(
        provider="firecrawl",
        operation="scrape",
        units=5,
        unit_type="credits",
        usd=0.05,
        run_id="run-1",
        place_id="places/abc",
    )
    store.record_cost_event(
        provider="google_places",
        operation="text_search",
        units=1,
        unit_type="requests",
        usd=0.032,
        run_id="run-1",
    )
    store.commit_cost_events()

    summary = store.cost_summary("run-1")
    assert summary["event_count"] == 2
    assert summary["usd_total"] == pytest.approx(0.082)
    assert "firecrawl" in summary["by_provider"]
    assert summary["by_provider"]["firecrawl"]["units_total"] == 5


def test_cost_summary_by_request_id(store: LeadStore) -> None:
    store.record_cost_event(
        provider="ai_gateway",
        operation="chat_completion",
        units=1200,
        unit_type="tokens",
        usd=0.001,
        request_id="req-42",
        model="gpt-4o-mini",
    )
    store.commit_cost_events()

    summary = store.cost_summary(None, request_id="req-42")
    assert summary["request_id"] == "req-42"
    assert summary["event_count"] == 1
    assert summary["units_total"] == 1200


def test_page_cache_round_trip(store: LeadStore) -> None:
    store.set_page_cache(
        "https://example.com/contact",
        content_type="markdown",
        content="# Contact Us",
        credits_used=3,
    )
    cached = store.get_page_cache("https://example.com/contact", content_type="markdown")
    assert cached is not None
    assert cached["content"] == "# Contact Us"
    assert cached["credits_used"] == 3


def test_page_cache_ttl_expiry(store: LeadStore) -> None:
    store.set_page_cache(
        "https://example.com/about",
        content_type="markdown",
        content="About page",
        credits_used=1,
    )
    old = (datetime.now(tz=UTC) - timedelta(days=30)).isoformat()
    store._local_cache._conn.execute(
        "UPDATE page_cache SET fetched_at = ? WHERE cache_key LIKE ?",
        (old, "markdown:%"),
    )
    store._local_cache._conn.commit()
    assert (
        store.get_page_cache(
            "https://example.com/about",
            content_type="markdown",
            ttl_days=7,
        )
        is None
    )


def test_usd_for_firecrawl_credits() -> None:
    pricing = load_pricing()
    assert usd_for(pricing, provider="firecrawl", operation="scrape", units=10) == pytest.approx(
        0.0533
    )


def test_record_credit_snapshot(store: LeadStore) -> None:
    store.record_credit_snapshot(
        provider="firecrawl",
        remaining_credits=450.0,
        used_credits=50.0,
        snapshot={"plan": "hobby"},
    )
    row = store._conn.execute(
        "SELECT remaining_credits, used_credits FROM credit_snapshots WHERE provider = 'firecrawl'"
    ).fetchone()
    assert row is not None
    assert float(row["remaining_credits"]) == 450.0


def test_record_cost_event_queues_on_persistent_operational_error(
    store: LeadStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    import sqlite3
    from unittest.mock import MagicMock

    mock_conn = MagicMock()
    mock_conn.execute.side_effect = sqlite3.OperationalError("database is locked")
    monkeypatch.setattr(store, "_conn", mock_conn)
    monkeypatch.setattr("pallares_leads.db.store.time.sleep", lambda _s: None)

    store.record_cost_event(
        provider="firecrawl",
        operation="scrape",
        units=1,
        usd=0.01,
    )
    assert mock_conn.execute.call_count == 8
    assert len(store._pending_cost_events) == 1

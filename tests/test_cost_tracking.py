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

    run_id = "run-cost-test-isolated"
    ensure_lead(store, "places/cost-isolated")
    store.record_cost_event(
        provider="firecrawl",
        operation="scrape",
        units=5,
        unit_type="credits",
        usd=0.05,
        run_id=run_id,
        place_id="places/cost-isolated",
        meta={"stage": "scrape", "duration_ms": 1200},
    )
    store.record_cost_event(
        provider="google_places",
        operation="text_search",
        units=1,
        unit_type="requests",
        usd=0.032,
        run_id=run_id,
    )
    store.commit_cost_events()

    summary = store.cost_summary(run_id)
    assert summary["event_count"] >= 2
    assert summary["usd_total"] >= 0.082
    assert "firecrawl" in summary["by_provider"]
    assert summary["by_provider"]["firecrawl"]["units_total"] >= 5

    row = store._conn.execute(
        """
        SELECT meta_json FROM cost_events
        WHERE run_id = ? AND provider = 'firecrawl' AND operation = 'scrape'
        ORDER BY id DESC LIMIT 1
        """,
        (run_id,),
    ).fetchone()
    assert row is not None
    meta = row["meta_json"]
    if isinstance(meta, str):
        import json

        meta = json.loads(meta)
    assert meta.get("stage") == "scrape"
    assert meta.get("duration_ms") == 1200


def test_cost_summary_by_request_id(store: LeadStore) -> None:
    request_id = "req-isolated-42"
    store.record_cost_event(
        provider="ai_gateway",
        operation="chat_completion",
        units=1200,
        unit_type="tokens",
        usd=0.001,
        request_id=request_id,
        model="gpt-4o-mini",
    )
    store.commit_cost_events()

    summary = store.cost_summary(None, request_id=request_id)
    assert summary["request_id"] == request_id
    assert summary["event_count"] >= 1
    assert summary["units_total"] >= 1200


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
        0.0099
    )


def test_record_credit_snapshot(store: LeadStore) -> None:
    store.record_credit_snapshot(
        provider="firecrawl",
        remaining_credits=450.0,
        used_credits=50.0,
        snapshot={"plan": "hobby"},
    )
    row = store._conn.execute(
        """
        SELECT remaining_credits, used_credits FROM credit_snapshots
        WHERE provider = 'firecrawl'
        ORDER BY id DESC LIMIT 1
        """
    ).fetchone()
    assert row is not None
    assert float(row["remaining_credits"]) == 450.0


def test_record_cost_event_includes_stage_and_duration(store: LeadStore) -> None:
    from helpers import ensure_lead

    from pallares_leads.enrich.firecrawl_client import FirecrawlClient
    from pallares_leads.settings import Settings

    run_id = "run-stage-meta-test"
    place_id = "places/stage-meta-test"
    ensure_lead(store, place_id)
    settings = Settings(firecrawl_api_key="test-key")
    client = FirecrawlClient(settings, store=store)
    client.set_cost_context(run_id=run_id, place_id=place_id, stage="scrape")
    client._last_op_duration_ms = 42
    client._record_cost_event(1, "scrape")

    row = store._conn.execute(
        """
        SELECT meta_json FROM cost_events
        WHERE run_id = ? AND place_id = ?
        ORDER BY id DESC LIMIT 1
        """,
        (run_id, place_id),
    ).fetchone()
    assert row is not None
    meta = row["meta_json"]
    if isinstance(meta, str):
        import json

        meta = json.loads(meta)
    assert meta.get("stage") == "scrape"
    assert meta.get("duration_ms") == 42


def test_extraction_cache_round_trip(store: LeadStore) -> None:
    store.set_extraction_cache(
        property_type="strip_mall",
        markdown_hash="abc123",
        result_json='{"site_contacts":[]}',
    )
    cached = store.get_extraction_cache(
        property_type="strip_mall",
        markdown_hash="abc123",
        ttl_days=7,
    )
    assert cached == '{"site_contacts":[]}'


def test_record_cost_event_queues_on_persistent_operational_error(
    store: LeadStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    from unittest.mock import MagicMock

    import psycopg

    original_conn = store._conn
    mock_conn = MagicMock()
    mock_conn.execute.side_effect = psycopg.OperationalError("database is locked")
    monkeypatch.setattr(store, "_conn", mock_conn)
    monkeypatch.setattr("pallares_leads.db.store.time.sleep", lambda _s: None)

    try:
        store.record_cost_event(
            provider="firecrawl",
            operation="scrape",
            units=1,
            usd=0.01,
        )
        assert mock_conn.execute.call_count == 8
        assert len(store._pending_cost_events) == 1
    finally:
        store._conn = original_conn
        store._pending_cost_events.clear()

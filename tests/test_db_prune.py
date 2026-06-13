import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from pallares_leads.db.store import LeadStore
from pallares_leads.schemas import RawLead


@pytest.fixture
def store(tmp_path: Path) -> LeadStore:
    db_path = tmp_path / "test.db"
    with LeadStore(db_path) as s:
        yield s


def test_prune_page_cache_expired(store: LeadStore, tmp_path: Path) -> None:
    store.set_page_cache(
        "https://example.com/old",
        content_type="markdown",
        content="old page",
        credits_used=1,
    )
    old = (datetime.now(tz=UTC) - timedelta(days=30)).isoformat()
    store._conn.execute(
        "UPDATE page_cache SET fetched_at = ?",
        (old,),
    )
    store._conn.commit()

    stats = store.prune_stale_data(
        runs_dir=tmp_path / "runs",
        page_cache_ttl_days=7,
        keep_days=30,
        dry_run=False,
    )
    assert stats["page_cache_deleted"] == 1
    assert store.get_page_cache("https://example.com/old", content_type="markdown") is None


def test_prune_run_folder_when_leads_in_db(store: LeadStore, tmp_path: Path) -> None:
    runs_dir = tmp_path / "runs"
    run_dir = runs_dir / "run-old"
    run_dir.mkdir(parents=True)
    raw_path = run_dir / "raw_reedley_strip_mall.jsonl"
    lead = RawLead(
        place_id="ChIJprune",
        business_name="Prune Test Plaza",
        formatted_address="1 Main St",
        city="Reedley",
        state="CA",
        property_type="strip_mall",
        lead_category="Strip Mall",
        market_key="reedley",
    )
    raw_path.write_text(json.dumps(lead.model_dump(mode="json")) + "\n", encoding="utf-8")

    old_mtime = datetime.now(tz=UTC) - timedelta(days=45)
    ts = old_mtime.timestamp()
    import os

    os.utime(run_dir, (ts, ts))

    store.touch_discovered(
        lead,
        market_key="reedley",
        category_key="strip_mall",
        run_id="run-old",
    )
    store._conn.commit()

    stats = store.prune_stale_data(
        runs_dir=runs_dir,
        page_cache_ttl_days=7,
        keep_days=30,
        dry_run=False,
    )
    assert stats["run_dirs_deleted"] == 1
    assert not run_dir.exists()


def test_prune_skips_run_when_lead_missing_from_db(store: LeadStore, tmp_path: Path) -> None:
    runs_dir = tmp_path / "runs"
    run_dir = runs_dir / "run-orphan"
    run_dir.mkdir(parents=True)
    lead = {
        "place_id": "ChIJmissing",
        "business_name": "Missing Lead",
        "formatted_address": "2 Main St",
        "city": "Reedley",
        "state": "CA",
        "property_type": "strip_mall",
        "lead_category": "Strip Mall",
    }
    (run_dir / "raw_reedley_strip_mall.jsonl").write_text(
        json.dumps(lead) + "\n",
        encoding="utf-8",
    )
    import os

    old_ts = (datetime.now(tz=UTC) - timedelta(days=45)).timestamp()
    os.utime(run_dir, (old_ts, old_ts))

    stats = store.prune_stale_data(
        runs_dir=runs_dir,
        page_cache_ttl_days=7,
        keep_days=30,
        dry_run=True,
    )
    assert stats["run_dirs_skipped"] == 1
    assert stats["run_dirs_deleted"] == 0
    assert run_dir.exists()

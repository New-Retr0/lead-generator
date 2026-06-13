from __future__ import annotations

from pathlib import Path

import pytest

from pallares_leads.db.store import LeadStore


def test_try_reserve_run_stage_caps(tmp_path: Path) -> None:
    with LeadStore(tmp_path / "test.db") as store:
        run_id = store.start_run(run_type="market", market_key="reedley", category_key="hoa")
        assert store.try_reserve_run_stage(run_id, "owner_chain", 2)
        assert store.try_reserve_run_stage(run_id, "owner_chain", 2)
        assert not store.try_reserve_run_stage(run_id, "owner_chain", 2)


def test_cost_event_queue_flushes_on_commit(tmp_path: Path) -> None:
    with LeadStore(tmp_path / "test.db") as store:
        run_id = store.start_run(run_type="market", market_key="reedley", category_key="hoa")
        store._pending_cost_events.append(
            (
                run_id,
                None,
                "place1",
                "firecrawl",
                "scrape",
                1.0,
                "credits",
                0.01,
                None,
                "{}",
                "2026-01-01T00:00:00+00:00",
            )
        )
        store._flush_pending_cost_events()
        total = store.run_credits_total(run_id)
        assert total == 1

from __future__ import annotations

import os
from pathlib import Path

import pytest

from pallares_leads.db.store import LeadStore

_TRUNCATE_SQL = """
TRUNCATE TABLE
  cost_events,
  run_events,
  credit_snapshots,
  sales_feedback,
  owner_records,
  enrichment_profiles,
  lead_facts,
  request_leads,
  lead_requests,
  leads,
  runs
RESTART IDENTITY CASCADE
"""


def _is_test_database() -> bool:
    url = os.getenv("SUPABASE_DB_URL", "")
    return any(token in url for token in ("localhost", "127.0.0.1", "pallares_test"))


pytestmark = pytest.mark.skipif(
    not os.getenv("SUPABASE_DB_URL") or not _is_test_database(),
    reason="SUPABASE_DB_URL must point at a local CI test database",
)


def _reset_store_data(store: LeadStore) -> None:
    if not _is_test_database():
        return
    with store._lock:
        try:
            store._conn.execute(_TRUNCATE_SQL)
            store._conn.commit()
        except Exception:
            store._raw_conn.rollback()
            raise


@pytest.fixture
def store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> LeadStore:
    cache_path = tmp_path / "local_cache.db"
    monkeypatch.setenv("LOCAL_CACHE_PATH", str(cache_path))
    db = LeadStore()
    _reset_store_data(db)
    yield db
    _reset_store_data(db)
    db.close()

from __future__ import annotations

import os
from pathlib import Path

import pytest
from dotenv import load_dotenv

from pallares_leads.db.store import LeadStore

load_dotenv()
load_dotenv(".env.local")

_TRUNCATE_TABLES = (
    "cost_events",
    "run_events",
    "credit_snapshots",
    "sales_feedback",
    "owner_records",
    "enrichment_profiles",
    "lead_facts",
    "request_leads",
    "lead_requests",
    "leads",
    "runs",
)


def _db_url() -> str:
    url = os.getenv("SUPABASE_DB_URL", "")
    if url:
        return url
    from pallares_leads.settings import get_settings

    return get_settings().supabase_db_url or ""


def _is_test_database() -> bool:
    url = _db_url()
    if not url:
        return False
    return any(token in url for token in ("localhost", "127.0.0.1", "pallares_test"))


_DB_SKIP_REASON = "SUPABASE_DB_URL must point at a local CI test database"


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if _db_url() and _is_test_database():
        return
    skip_db = pytest.mark.skip(reason=_DB_SKIP_REASON)
    for item in items:
        if "store" in getattr(item, "fixturenames", ()):
            item.add_marker(skip_db)


def _reset_store_data(store: LeadStore) -> None:
    if not _is_test_database():
        return
    with store._lock:
        try:
            tables = ", ".join(_TRUNCATE_TABLES)
            store._conn.execute(f"TRUNCATE TABLE {tables} RESTART IDENTITY CASCADE")
            store._conn.commit()
        except Exception:
            store._raw_conn.rollback()
            for table in _TRUNCATE_TABLES:
                try:
                    store._conn.execute(f"DELETE FROM {table}")
                except Exception:
                    store._raw_conn.rollback()
                    continue
            store._conn.commit()


@pytest.fixture
def store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> LeadStore:
    cache_path = tmp_path / "local_cache.db"
    monkeypatch.setenv("LOCAL_CACHE_PATH", str(cache_path))
    db = LeadStore()
    _reset_store_data(db)
    yield db
    _reset_store_data(db)
    db.close()

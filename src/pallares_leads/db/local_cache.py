"""Operator-local SQLite cache for page and domain lookups (not in Supabase)."""

from __future__ import annotations

import sqlite3
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any


def _utc_now() -> datetime:
    return datetime.now(tz=UTC)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


class LocalCache:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(str(path), check_same_thread=False, timeout=60.0)
        self._conn.row_factory = sqlite3.Row
        self._init()

    def close(self) -> None:
        self._conn.close()

    def _init(self) -> None:
        with self._lock:
            self._conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS domain_cache (
                    hostname TEXT PRIMARY KEY,
                    is_valid INTEGER NOT NULL,
                    checked_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS page_cache (
                    cache_key TEXT PRIMARY KEY,
                    url TEXT NOT NULL,
                    content_type TEXT NOT NULL,
                    content TEXT NOT NULL,
                    credits_used INTEGER NOT NULL DEFAULT 0,
                    fetched_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_page_cache_fetched_at ON page_cache(fetched_at);
                CREATE TABLE IF NOT EXISTS extraction_cache (
                    cache_key TEXT PRIMARY KEY,
                    result_json TEXT NOT NULL,
                    fetched_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_extraction_cache_fetched_at
                    ON extraction_cache(fetched_at);
                """
            )
            self._conn.commit()

    def get_domain_cache(self, hostname: str, *, ttl_hours: int = 24) -> bool | None:
        row = self._conn.execute(
            "SELECT is_valid, checked_at FROM domain_cache WHERE hostname = ?",
            (hostname.lower(),),
        ).fetchone()
        if row is None:
            return None
        checked = datetime.fromisoformat(row["checked_at"])
        if _utc_now() - checked > timedelta(hours=ttl_hours):
            return None
        return bool(row["is_valid"])

    def set_domain_cache(self, hostname: str, is_valid: bool) -> None:
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO domain_cache (hostname, is_valid, checked_at)
                VALUES (?, ?, ?)
                ON CONFLICT(hostname) DO UPDATE SET
                    is_valid = excluded.is_valid,
                    checked_at = excluded.checked_at
                """,
                (hostname.lower(), 1 if is_valid else 0, _iso(_utc_now())),
            )
            self._conn.commit()

    @staticmethod
    def page_cache_key(url: str, content_type: str) -> str:
        normalized = url.split("#")[0].rstrip("/").lower()
        return f"{content_type}:{normalized}"

    def get_page_cache(
        self,
        url: str,
        *,
        content_type: str = "markdown",
        ttl_days: int | None = None,
    ) -> dict[str, Any] | None:
        cache_key = self.page_cache_key(url, content_type)
        row = self._conn.execute(
            "SELECT url, content_type, content, credits_used, fetched_at "
            "FROM page_cache WHERE cache_key = ?",
            (cache_key,),
        ).fetchone()
        if row is None:
            return None
        if ttl_days is not None:
            fetched = datetime.fromisoformat(row["fetched_at"])
            if _utc_now() - fetched > timedelta(days=ttl_days):
                return None
        return dict(row)

    def set_page_cache(
        self,
        url: str,
        *,
        content_type: str,
        content: str,
        credits_used: int = 0,
    ) -> None:
        cache_key = self.page_cache_key(url, content_type)
        now = _iso(_utc_now())
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO page_cache (
                    cache_key, url, content_type, content, credits_used, fetched_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(cache_key) DO UPDATE SET
                    url = excluded.url,
                    content_type = excluded.content_type,
                    content = excluded.content,
                    credits_used = excluded.credits_used,
                    fetched_at = excluded.fetched_at
                """,
                (cache_key, url, content_type, content, credits_used, now),
            )
            self._conn.commit()

    def get_extraction_cache(
        self,
        cache_key: str,
        *,
        ttl_days: int | None = None,
    ) -> str | None:
        row = self._conn.execute(
            "SELECT result_json, fetched_at FROM extraction_cache WHERE cache_key = ?",
            (cache_key,),
        ).fetchone()
        if row is None:
            return None
        if ttl_days is not None:
            fetched = datetime.fromisoformat(row["fetched_at"])
            if _utc_now() - fetched > timedelta(days=ttl_days):
                return None
        return str(row["result_json"])

    def set_extraction_cache(self, cache_key: str, result_json: str) -> None:
        now = _iso(_utc_now())
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO extraction_cache (cache_key, result_json, fetched_at)
                VALUES (?, ?, ?)
                ON CONFLICT(cache_key) DO UPDATE SET
                    result_json = excluded.result_json,
                    fetched_at = excluded.fetched_at
                """,
                (cache_key, result_json, now),
            )
            self._conn.commit()

    def prune_page_cache(self, *, ttl_days: int, dry_run: bool = False) -> int:
        cutoff = _iso(_utc_now() - timedelta(days=ttl_days))
        if dry_run:
            row = self._conn.execute(
                "SELECT COUNT(*) AS n FROM page_cache WHERE fetched_at < ?",
                (cutoff,),
            ).fetchone()
            return int(row["n"]) if row else 0
        with self._lock:
            cur = self._conn.execute("DELETE FROM page_cache WHERE fetched_at < ?", (cutoff,))
            self._conn.commit()
            return int(cur.rowcount)

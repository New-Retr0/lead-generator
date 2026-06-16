"""Postgres connection helpers for Supabase."""

from __future__ import annotations

import json
import threading
from datetime import datetime
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Json

_pool_lock = threading.Lock()
_pools: dict[str, psycopg.Connection] = {}


def _coerce_param(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return Json(value)
    return value


def _coerce_params(params: tuple[Any, ...] | list[Any]) -> tuple[Any, ...]:
    return tuple(_coerce_param(p) for p in params)


def adapt_sql(sql: str) -> str:
    return sql.replace("?", "%s")


def parse_json_field(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        return json.loads(value)
    return value


def to_db_timestamp(value: str | datetime | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class PgCursor:
    def __init__(self, cursor: psycopg.Cursor) -> None:
        self._cursor = cursor

    @property
    def rowcount(self) -> int:
        return self._cursor.rowcount

    def fetchone(self) -> dict[str, Any] | None:
        return self._cursor.fetchone()

    def fetchall(self) -> list[dict[str, Any]]:
        return self._cursor.fetchall()


class PgAdapter:
    """SQLite-shaped API over a psycopg connection."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def execute(self, sql: str, params: tuple[Any, ...] | list[Any] = ()) -> PgCursor:
        cur = self._conn.execute(adapt_sql(sql), _coerce_params(tuple(params)))
        return PgCursor(cur)

    def commit(self) -> None:
        self._conn.commit()

    def rollback(self) -> None:
        self._conn.rollback()


def connect(db_url: str) -> PgAdapter:
    conn = psycopg.connect(
        db_url,
        row_factory=dict_row,
        prepare_threshold=None,
        autocommit=False,
    )
    return PgAdapter(conn)


def get_shared_connection(db_url: str) -> PgAdapter:
    with _pool_lock:
        existing = _pools.get(db_url)
        if existing is not None and not existing.closed:
            return PgAdapter(existing)
        conn = psycopg.connect(
            db_url,
            row_factory=dict_row,
            prepare_threshold=None,
            autocommit=False,
        )
        _pools[db_url] = conn
        return PgAdapter(conn)

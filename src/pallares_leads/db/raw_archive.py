"""Local SQLite archive for raw API payloads (zlib-compressed, deduped by sha256)."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import zlib
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pallares_leads.settings import Settings

_TRUNCATION_MARKER = {"_truncated": True, "_reason": "raw_capture_max_bytes exceeded"}

_archive: RawArchive | None = None
_archive_lock = threading.Lock()


def _utc_iso() -> str:
    return datetime.now(tz=UTC).isoformat()


def _sanitize_request(request: dict[str, Any] | None) -> str | None:
    if request is None:
        return None
    cleaned = _strip_secrets(request)
    return json.dumps(cleaned, ensure_ascii=False, separators=(",", ":"))


def _strip_secrets(value: Any) -> Any:
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            lower = str(key).lower()
            if lower in {"authorization", "x-goog-api-key", "api_key", "api-key"}:
                out[key] = "[REDACTED]"
            elif lower == "headers" and isinstance(item, dict):
                out[key] = {
                    k: "[REDACTED]"
                    if str(k).lower() in {"authorization", "x-goog-api-key", "api-key"}
                    else _strip_secrets(v)
                    for k, v in item.items()
                }
            else:
                out[key] = _strip_secrets(item)
        return out
    if isinstance(value, list):
        return [_strip_secrets(item) for item in value]
    return value


def _normalize_response(response: Any, *, max_bytes: int) -> bytes:
    if hasattr(response, "model_dump"):
        payload: Any = response.model_dump(mode="json")
    elif isinstance(response, (dict, list)):
        payload = response
    else:
        payload = {"value": str(response)}

    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) <= max_bytes:
        return encoded

    preview = encoded[: max_bytes // 2].decode("utf-8", errors="replace")
    truncated = json.dumps(
        {**_TRUNCATION_MARKER, "preview": preview},
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return truncated


class RawArchive:
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
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS raw_captures (
                    id INTEGER PRIMARY KEY,
                    provider TEXT NOT NULL,
                    operation TEXT NOT NULL,
                    place_id TEXT,
                    run_id TEXT,
                    request_json TEXT,
                    response_blob BLOB NOT NULL,
                    response_sha256 TEXT NOT NULL,
                    status TEXT,
                    duration_ms INTEGER,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_raw_captures_dedupe
                    ON raw_captures (provider, operation, place_id, response_sha256);
                CREATE INDEX IF NOT EXISTS idx_raw_captures_provider
                    ON raw_captures (provider, created_at);
                """
            )
            self._conn.commit()

    def record_capture(
        self,
        provider: str,
        operation: str,
        *,
        place_id: str | None = None,
        run_id: str | None = None,
        request: dict[str, Any] | None = None,
        response: Any,
        status: str = "ok",
        duration_ms: int | None = None,
        max_bytes: int = 400_000,
    ) -> bool:
        response_bytes = _normalize_response(response, max_bytes=max_bytes)
        response_sha256 = hashlib.sha256(response_bytes).hexdigest()
        request_json = _sanitize_request(request)
        blob = zlib.compress(response_bytes, level=6)

        with self._lock:
            existing = self._conn.execute(
                """
                SELECT id FROM raw_captures
                WHERE provider = ? AND operation = ? AND place_id IS ? AND response_sha256 = ?
                LIMIT 1
                """,
                (provider, operation, place_id, response_sha256),
            ).fetchone()
            if existing is not None:
                return False

            self._conn.execute(
                """
                INSERT INTO raw_captures (
                    provider, operation, place_id, run_id, request_json,
                    response_blob, response_sha256, status, duration_ms, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    provider,
                    operation,
                    place_id,
                    run_id,
                    request_json,
                    blob,
                    response_sha256,
                    status,
                    duration_ms,
                    _utc_iso(),
                ),
            )
            self._conn.commit()
        return True

    def decode_response(self, blob: bytes) -> Any:
        raw = zlib.decompress(blob)
        return json.loads(raw.decode("utf-8"))

    def stats(self) -> dict[str, Any]:
        rows = self._conn.execute(
            """
            SELECT provider,
                   COUNT(*) AS capture_count,
                   SUM(LENGTH(response_blob)) AS blob_bytes
            FROM raw_captures
            GROUP BY provider
            ORDER BY provider
            """
        ).fetchall()
        by_provider = [
            {
                "provider": row["provider"],
                "count": int(row["capture_count"]),
                "blob_bytes": int(row["blob_bytes"] or 0),
            }
            for row in rows
        ]
        total_count = sum(item["count"] for item in by_provider)
        total_bytes = sum(item["blob_bytes"] for item in by_provider)
        return {
            "path": str(self.path),
            "total_count": total_count,
            "total_blob_bytes": total_bytes,
            "by_provider": by_provider,
        }


def get_raw_archive(settings: Settings) -> RawArchive:
    global _archive
    path = settings.raw_archive_path
    with _archive_lock:
        if _archive is None or _archive.path != path:
            if _archive is not None:
                _archive.close()
            _archive = RawArchive(path)
        return _archive


def reset_raw_archive_for_tests() -> None:
    global _archive
    with _archive_lock:
        if _archive is not None:
            _archive.close()
            _archive = None


def record_capture(
    settings: Settings,
    provider: str,
    operation: str,
    *,
    place_id: str | None = None,
    run_id: str | None = None,
    request: dict[str, Any] | None = None,
    response: Any,
    status: str = "ok",
    duration_ms: int | None = None,
) -> bool:
    if not settings.raw_capture_enabled:
        return False
    archive = get_raw_archive(settings)
    return archive.record_capture(
        provider,
        operation,
        place_id=place_id,
        run_id=run_id,
        request=request,
        response=response,
        status=status,
        duration_ms=duration_ms,
        max_bytes=settings.raw_capture_max_bytes,
    )


__all__ = [
    "RawArchive",
    "get_raw_archive",
    "record_capture",
    "reset_raw_archive_for_tests",
]

"""Structured progress events for live pipeline observability.

When PALLARES_LOG_JSON=1, each event is one JSON line on stdout so the
dashboard can parse stages, credits, and verification rejections in real time.
"""

from __future__ import annotations

import json
import os
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from pallares_leads.db.store import LeadStore

_progress_store: ContextVar[LeadStore | None] = ContextVar("_progress_store", default=None)
_progress_run_id: ContextVar[str | None] = ContextVar("_progress_run_id", default=None)


def _enabled() -> bool:
    return os.environ.get("PALLARES_LOG_JSON", "").strip().lower() in {"1", "true", "yes"}


def bind_progress(store: LeadStore | None, *, run_id: str | None = None) -> None:
    """Attach the active store (and optional run id) for incremental run_events writes."""
    _progress_store.set(store)
    if run_id is not None:
        _progress_run_id.set(run_id)


def emit(event: str, **fields: Any) -> None:
    """Print one structured progress line (JSON when enabled, else human text)."""
    ts = datetime.now(tz=UTC).isoformat()
    payload = {
        "t": "evt",
        "ts": ts,
        "event": event,
        **{k: v for k, v in fields.items() if v is not None},
    }
    run_id = fields.get("run_id") or _progress_run_id.get()
    store = _progress_store.get()
    if store and run_id:
        store.record_progress_event(
            run_id=str(run_id),
            event=event,
            ts=ts,
            place_id=fields.get("place_id"),
            business=fields.get("business"),
            credits=fields.get("credits"),
            duration_ms=fields.get("duration_ms"),
            reason=fields.get("reason"),
            extra={
                k: v
                for k, v in fields.items()
                if k
                not in {
                    "run_id",
                    "place_id",
                    "business",
                    "credits",
                    "duration_ms",
                    "reason",
                }
                and v is not None
            },
        )

    if _enabled():
        print(json.dumps(payload, ensure_ascii=False), flush=True)
        return

    detail = " ".join(
        f"{k}={v}" for k, v in fields.items() if k not in {"place_id", "business"} and v is not None
    )
    label = fields.get("business") or fields.get("place_id") or ""
    prefix = f"[{event}]"
    if label:
        prefix = f"[{event}] {label}"
    if detail:
        print(f"{prefix} {detail}", flush=True)
    else:
        print(prefix, flush=True)


def emit_human(message: str) -> None:
    """Always print a human-readable line (mirrors standard logging)."""
    if not _enabled():
        print(message, flush=True)


def emit_rejection(
    *,
    place_id: str,
    business: str,
    kind: str,
    value: str,
    reason: str,
    context: str = "",
) -> None:
    emit(
        "verification_rejected",
        place_id=place_id,
        business=business,
        kind=kind,
        value=value,
        reason=reason,
        context=context,
    )

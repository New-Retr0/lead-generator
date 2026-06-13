"""Structured progress events for live pipeline observability.

When PALLARES_LOG_JSON=1, each event is one JSON line on stdout so the
dashboard can parse stages, credits, and verification rejections in real time.
"""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from typing import Any


def _enabled() -> bool:
    return os.environ.get("PALLARES_LOG_JSON", "").strip().lower() in {"1", "true", "yes"}


def emit(event: str, **fields: Any) -> None:
    """Print one structured progress line (JSON when enabled, else human text)."""
    payload = {
        "t": "evt",
        "ts": datetime.now(tz=UTC).isoformat(),
        "event": event,
        **{k: v for k, v in fields.items() if v is not None},
    }
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

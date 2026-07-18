"""Exception formatting helpers for run observability."""

from __future__ import annotations

import traceback
from typing import Any


def exception_brief(exc: BaseException, *, limit: int = 500) -> str:
    """One-line failure summary for stop_detail / badges."""
    name = type(exc).__name__
    msg = str(exc).strip()
    text = f"{name}: {msg}" if msg else name
    return text[:limit]


def exception_trace(*, limit: int = 8_000) -> str:
    """Current exception traceback for runs.error (truncated)."""
    return traceback.format_exc()[:limit]


def stop_reason_for(exc: BaseException) -> str:
    if isinstance(exc, KeyboardInterrupt):
        return "interrupted"
    if isinstance(exc, SystemExit):
        return "interrupted"
    return "exception"


def failure_fields(exc: BaseException) -> dict[str, Any]:
    """kwargs suitable for finish_run / progress_emit on failure."""
    return {
        "stop_reason": stop_reason_for(exc),
        "stop_detail": exception_brief(exc),
        "error": exception_trace(),
    }

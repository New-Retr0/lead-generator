from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from typing import TypeVar

import httpx

logger = logging.getLogger(__name__)

T = TypeVar("T")

RETRY_STATUS = frozenset({429, 500, 502, 503, 504})

_circuit_lock = threading.Lock()
_circuit_open_until: dict[str, float] = {}


class OutOfCreditsError(Exception):
    """Raised when an API returns HTTP 402 (credits exhausted)."""


def reset_http_circuits() -> None:
    with _circuit_lock:
        _circuit_open_until.clear()


def circuit_is_open(label: str) -> bool:
    with _circuit_lock:
        until = _circuit_open_until.get(label, 0.0)
        return time.monotonic() < until


def trip_circuit(label: str, cooldown_s: float) -> None:
    with _circuit_lock:
        until = time.monotonic() + max(1.0, cooldown_s)
        prior = _circuit_open_until.get(label, 0.0)
        if until > prior:
            _circuit_open_until[label] = until
            logger.warning("%s circuit open for %.0fs after repeated 429s", label, cooldown_s)


def parse_retry_after(value: str | None) -> float | None:
    """Parse Retry-After as seconds. Rejects HTTP-date forms and negatives."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        seconds = float(text)
    except ValueError:
        return None
    if seconds < 0:
        return None
    return seconds


def request_with_retry(
    fn: Callable[[], httpx.Response],
    *,
    max_attempts: int = 3,
    base_delay_s: float = 1.0,
    label: str = "HTTP",
    circuit_cooldown_s: float = 60.0,
    on_rate_limit: Callable[[float], None] | None = None,
    on_success: Callable[[], None] | None = None,
) -> httpx.Response:
    """Execute an httpx call with exponential backoff on transient failures."""
    if circuit_is_open(label):
        raise httpx.HTTPError(f"{label} circuit open — backing off after 429s")

    last_exc: Exception | None = None
    consecutive_429 = 0
    for attempt in range(1, max_attempts + 1):
        try:
            response = fn()
            if response.status_code == 402:
                raise OutOfCreditsError(f"{label} HTTP 402 — Firecrawl credits exhausted")
            if response.status_code == 429:
                consecutive_429 += 1
            if response.status_code in RETRY_STATUS and attempt < max_attempts:
                delay = base_delay_s * (2 ** (attempt - 1))
                retry_after = parse_retry_after(response.headers.get("Retry-After"))
                if retry_after is not None:
                    delay = max(delay, retry_after)
                if response.status_code == 429 and on_rate_limit is not None:
                    on_rate_limit(delay)
                logger.warning(
                    "%s HTTP %s — retry %d/%d in %.1fs",
                    label,
                    response.status_code,
                    attempt,
                    max_attempts,
                    delay,
                )
                time.sleep(delay)
                continue
            if response.status_code == 429:
                if on_rate_limit is not None:
                    retry_after = parse_retry_after(response.headers.get("Retry-After"))
                    on_rate_limit(retry_after if retry_after is not None else base_delay_s)
                if consecutive_429 >= max_attempts:
                    trip_circuit(label, circuit_cooldown_s)
                return response
            if 200 <= response.status_code < 300 and on_success is not None:
                on_success()
            return response
        except httpx.HTTPError as exc:
            last_exc = exc
            if attempt >= max_attempts:
                raise
            delay = base_delay_s * (2 ** (attempt - 1))
            logger.warning(
                "%s error %s — retry %d/%d in %.1fs", label, exc, attempt, max_attempts, delay
            )
            time.sleep(delay)
    if last_exc:
        raise last_exc
    raise RuntimeError(f"{label} request failed after retries")

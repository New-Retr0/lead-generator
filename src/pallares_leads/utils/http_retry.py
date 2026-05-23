from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import TypeVar

import httpx

logger = logging.getLogger(__name__)

T = TypeVar("T")

RETRY_STATUS = frozenset({429, 500, 502, 503, 504})


def request_with_retry(
    fn: Callable[[], httpx.Response],
    *,
    max_attempts: int = 3,
    base_delay_s: float = 1.0,
    label: str = "HTTP",
) -> httpx.Response:
    """Execute an httpx call with exponential backoff on transient failures."""
    last_exc: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            response = fn()
            if response.status_code in RETRY_STATUS and attempt < max_attempts:
                delay = base_delay_s * (2 ** (attempt - 1))
                retry_after = response.headers.get("Retry-After")
                if retry_after and retry_after.isdigit():
                    delay = max(delay, float(retry_after))
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
            return response
        except httpx.HTTPError as exc:
            last_exc = exc
            if attempt >= max_attempts:
                raise
            delay = base_delay_s * (2 ** (attempt - 1))
            logger.warning("%s error %s — retry %d/%d in %.1fs", label, exc, attempt, max_attempts, delay)
            time.sleep(delay)
    if last_exc:
        raise last_exc
    raise RuntimeError(f"{label} request failed after retries")

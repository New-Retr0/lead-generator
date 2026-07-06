"""Vercel AI Gateway client — throttled, retried, cost-tracked."""

from __future__ import annotations

import logging
import threading
import time
from typing import TYPE_CHECKING, Any

import httpx
from pydantic import BaseModel

from pallares_leads.costs import load_pricing, usd_for
from pallares_leads.db.raw_archive import record_capture
from pallares_leads.settings import Settings

if TYPE_CHECKING:
    from pallares_leads.db.store import LeadStore

logger = logging.getLogger(__name__)

AI_GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions"

_throttle_lock = threading.Lock()
_last_call_monotonic = 0.0
_circuit_open_until = 0.0
_parallel_enrichment_workers = 1


def set_gateway_parallel_workers(workers: int) -> None:
    """Scale spacing when many enrichment threads finish Firecrawl together."""
    global _parallel_enrichment_workers
    _parallel_enrichment_workers = max(1, workers)


def gateway_configured(settings: Settings) -> bool:
    return bool(
        settings.ai_gateway_enabled and settings.ai_gateway_api_key and settings.ai_gateway_model
    )


def reset_gateway_client_state_for_tests() -> None:
    """Clear throttle/circuit state between tests."""
    global _last_call_monotonic, _circuit_open_until, _parallel_enrichment_workers
    with _throttle_lock:
        _last_call_monotonic = 0.0
        _circuit_open_until = 0.0
        _parallel_enrichment_workers = 1


def _circuit_open_unlocked() -> bool:
    return time.monotonic() < _circuit_open_until


def _circuit_open() -> bool:
    with _throttle_lock:
        return _circuit_open_unlocked()


def _trip_circuit(cooldown_s: float) -> None:
    global _circuit_open_until
    if cooldown_s <= 0:
        return
    with _throttle_lock:
        until = time.monotonic() + cooldown_s
        if until > _circuit_open_until:
            _circuit_open_until = until
            logger.warning(
                "AI Gateway rate-limited — skipping further copy/planner calls for %.0fs",
                cooldown_s,
            )


def _effective_interval_s(settings: Settings) -> float:
    """Base spacing × parallel workers so bursts stay under free-tier RPM."""
    base = max(0.0, settings.ai_gateway_min_interval_s)
    if base <= 0:
        return 0.0
    return base * _parallel_enrichment_workers


def _wait_for_slot_unlocked(settings: Settings) -> None:
    """Caller must hold _throttle_lock."""
    global _last_call_monotonic
    interval = _effective_interval_s(settings)
    if interval <= 0:
        return
    now = time.monotonic()
    wait = interval - (now - _last_call_monotonic)
    if wait > 0:
        logger.debug("AI Gateway throttle: waiting %.1fs", wait)
        time.sleep(wait)


class GatewayCompletionResult(BaseModel):
    content: str | None = None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    duration_ms: int = 0


def gateway_chat_completion(
    settings: Settings,
    *,
    system_prompt: str,
    user_content: str,
    timeout: float = 60.0,
    store: LeadStore | None = None,
    run_id: str | None = None,
    request_id: str | None = None,
    place_id: str | None = None,
    operation: str = "chat_completion",
    response_format: dict[str, Any] | None = None,
    prompt_version: str | None = None,
    temperature: float | None = None,
    stage: str | None = None,
) -> GatewayCompletionResult | None:
    if not gateway_configured(settings):
        return None

    if _circuit_open():
        logger.info("AI Gateway circuit open — skipping %s", operation)
        return None

    body: dict[str, Any] = {
        "model": settings.ai_gateway_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
    }
    if response_format is not None:
        body["response_format"] = response_format
    if temperature is not None:
        body["temperature"] = temperature

    max_attempts = max(1, settings.ai_gateway_max_retries)
    headers = {
        "Authorization": f"Bearer {settings.ai_gateway_api_key}",
        "Content-Type": "application/json",
    }

    global _last_call_monotonic
    call_started = time.perf_counter()

    with httpx.Client(timeout=timeout) as client:
        response: httpx.Response | None = None
        for attempt in range(1, max_attempts + 1):
            try:
                with _throttle_lock:
                    if _circuit_open_unlocked():
                        logger.info("AI Gateway circuit open — skipping %s", operation)
                        return None
                    _wait_for_slot_unlocked(settings)
                    response = client.post(AI_GATEWAY_URL, headers=headers, json=body)
                    _last_call_monotonic = time.monotonic()
            except httpx.HTTPError as exc:
                if attempt >= max_attempts:
                    logger.warning("AI Gateway request failed: %s", exc)
                    return None
                delay = max(0.5, settings.ai_gateway_retry_base_delay_s) * (2 ** (attempt - 1))
                logger.warning(
                    "AI Gateway error %s — retry %d/%d in %.1fs",
                    exc,
                    attempt,
                    max_attempts,
                    delay,
                )
                time.sleep(delay)
                continue

            if response.status_code in {429, 500, 502, 503, 504} and attempt < max_attempts:
                delay = max(0.5, settings.ai_gateway_retry_base_delay_s) * (2 ** (attempt - 1))
                logger.warning(
                    "AI Gateway HTTP %s — retry %d/%d in %.1fs",
                    response.status_code,
                    attempt,
                    max_attempts,
                    delay,
                )
                time.sleep(delay)
                continue
            break

        if response is None:
            return None

        if response.status_code == 429:
            _trip_circuit(settings.ai_gateway_rate_limit_cooldown_s)
            logger.warning(
                "AI Gateway rate-limited after retries: HTTP 429 %s",
                response.text[:200],
            )
            return None

        if response.status_code >= 400:
            logger.warning(
                "AI Gateway request failed: HTTP %s %s",
                response.status_code,
                response.text[:300],
            )
            return None

        duration_ms = int((time.perf_counter() - call_started) * 1000)
        payload: dict[str, Any] = response.json()
        content = payload.get("choices", [{}])[0].get("message", {}).get("content")
        usage = payload.get("usage") or {}
        prompt_tokens = int(usage.get("prompt_tokens") or 0)
        completion_tokens = int(usage.get("completion_tokens") or 0)
        total_tokens = int(usage.get("total_tokens") or prompt_tokens + completion_tokens)

        if store:
            pricing = load_pricing(settings.config_dir)
            cost_usd = usd_for(
                pricing,
                provider="ai_gateway",
                operation="chat_completion",
                model=settings.ai_gateway_model,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
            )
            meta: dict[str, Any] = {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "duration_ms": duration_ms,
            }
            if prompt_version:
                meta["prompt_version"] = prompt_version
            if stage:
                meta["stage"] = stage
            store.record_cost_event(
                provider="ai_gateway",
                operation=operation,
                units=total_tokens,
                unit_type="tokens",
                usd=cost_usd,
                run_id=run_id,
                request_id=request_id,
                place_id=place_id,
                model=settings.ai_gateway_model,
                meta=meta,
            )
            store.commit_cost_events()

        record_capture(
            settings,
            "ai_gateway",
            operation,
            place_id=place_id,
            run_id=run_id,
            request={
                "model": settings.ai_gateway_model,
                "messages": body.get("messages"),
                "operation": operation,
            },
            response={
                "content": content,
                "usage": usage,
                "raw": payload,
            },
            duration_ms=duration_ms,
        )

        return GatewayCompletionResult(
            content=content if isinstance(content, str) else None,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            duration_ms=duration_ms,
        )


__all__ = [
    "AI_GATEWAY_URL",
    "GatewayCompletionResult",
    "gateway_chat_completion",
    "gateway_configured",
    "reset_gateway_client_state_for_tests",
    "set_gateway_parallel_workers",
]

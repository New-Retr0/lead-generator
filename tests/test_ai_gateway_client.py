from __future__ import annotations

from unittest.mock import MagicMock, patch

import httpx
import pytest

from pallares_leads.enrich.ai_gateway_client import (
    gateway_chat_completion,
    reset_gateway_client_state_for_tests,
    set_gateway_parallel_workers,
)
from pallares_leads.settings import Settings


@pytest.fixture(autouse=True)
def _reset_gateway_state() -> None:
    reset_gateway_client_state_for_tests()
    yield
    reset_gateway_client_state_for_tests()


def _settings(**overrides) -> Settings:
    base = {
        "ai_gateway_api_key": "gw-key",
        "ai_gateway_model": "google/gemini-2.5-flash",
        "ai_gateway_min_interval_s": 0.0,
        "ai_gateway_max_retries": 3,
        "ai_gateway_retry_base_delay_s": 0.01,
        "ai_gateway_rate_limit_cooldown_s": 0.0,
    }
    base.update(overrides)
    return Settings(**base)


def test_gateway_retries_then_succeeds() -> None:
    reset_gateway_client_state_for_tests()
    responses = [
        httpx.Response(429, json={"error": "rate_limit"}, headers={"Retry-After": "0"}),
        httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": '{"why_call":"ok"}'}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
            },
        ),
    ]

    with patch("pallares_leads.enrich.ai_gateway_client.httpx.Client") as mock_client_cls:
        mock_client = MagicMock()
        mock_client.__enter__.return_value = mock_client
        mock_client.post.side_effect = responses
        mock_client_cls.return_value = mock_client

        with patch("pallares_leads.enrich.ai_gateway_client.time.sleep"):
            result = gateway_chat_completion(
                _settings(),
                system_prompt="sys",
                user_content="user",
            )

    assert result is not None
    assert result.content is not None
    assert mock_client.post.call_count == 2


def test_gateway_throttle_waits_between_calls() -> None:
    reset_gateway_client_state_for_tests()
    ok = httpx.Response(
        200,
        json={
            "choices": [{"message": {"content": "hi"}}],
            "usage": {"total_tokens": 1},
        },
    )

    with patch("pallares_leads.enrich.ai_gateway_client.httpx.Client") as mock_client_cls:
        mock_client = MagicMock()
        mock_client.__enter__.return_value = mock_client
        mock_client.post.return_value = ok
        mock_client_cls.return_value = mock_client

        clock = {"t": 0.0}

        def tick() -> float:
            clock["t"] += 1.0
            return clock["t"]

        with (
            patch("pallares_leads.enrich.ai_gateway_client.time.monotonic", side_effect=tick),
            patch("pallares_leads.enrich.ai_gateway_client.time.sleep") as mock_sleep,
        ):
            gateway_chat_completion(
                _settings(ai_gateway_min_interval_s=4.0),
                system_prompt="a",
                user_content="b",
            )
            gateway_chat_completion(
                _settings(ai_gateway_min_interval_s=4.0),
                system_prompt="a",
                user_content="b",
            )

    assert mock_sleep.call_count >= 1
    assert mock_sleep.call_args.args[0] >= 1.0


def test_gateway_throttle_scales_with_parallel_workers() -> None:
    reset_gateway_client_state_for_tests()
    ok = httpx.Response(
        200,
        json={
            "choices": [{"message": {"content": "hi"}}],
            "usage": {"total_tokens": 1},
        },
    )

    with patch("pallares_leads.enrich.ai_gateway_client.httpx.Client") as mock_client_cls:
        mock_client = MagicMock()
        mock_client.__enter__.return_value = mock_client
        mock_client.post.return_value = ok
        mock_client_cls.return_value = mock_client

        clock = {"t": 0.0}

        def tick() -> float:
            clock["t"] += 1.0
            return clock["t"]

        set_gateway_parallel_workers(5)
        with (
            patch("pallares_leads.enrich.ai_gateway_client.time.monotonic", side_effect=tick),
            patch("pallares_leads.enrich.ai_gateway_client.time.sleep") as mock_sleep,
        ):
            gateway_chat_completion(
                _settings(ai_gateway_min_interval_s=4.0),
                system_prompt="a",
                user_content="b",
            )
            gateway_chat_completion(
                _settings(ai_gateway_min_interval_s=4.0),
                system_prompt="a",
                user_content="b",
            )

    # 4s base × 5 workers = 20s spacing; clock advances 1s/tick so wait ≈ 19s
    assert mock_sleep.call_count >= 1
    assert mock_sleep.call_args.args[0] >= 15.0


def test_gateway_circuit_skips_after_429_exhausted() -> None:
    reset_gateway_client_state_for_tests()
    exhausted = httpx.Response(429, json={"error": "rate_limit"})

    with patch("pallares_leads.enrich.ai_gateway_client.httpx.Client") as mock_client_cls:
        mock_client = MagicMock()
        mock_client.__enter__.return_value = mock_client
        mock_client.post.return_value = exhausted
        mock_client_cls.return_value = mock_client

        with patch("pallares_leads.enrich.ai_gateway_client.time.sleep"):
            first = gateway_chat_completion(
                _settings(ai_gateway_max_retries=1, ai_gateway_rate_limit_cooldown_s=60.0),
                system_prompt="sys",
                user_content="user",
            )
            second = gateway_chat_completion(
                _settings(ai_gateway_max_retries=1, ai_gateway_rate_limit_cooldown_s=60.0),
                system_prompt="sys",
                user_content="user",
            )

    assert first is None
    assert second is None
    assert mock_client.post.call_count == 1

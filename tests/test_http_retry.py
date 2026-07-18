from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

from pallares_leads.utils.http_retry import (
    parse_retry_after,
    request_with_retry,
    reset_http_circuits,
)


@pytest.fixture(autouse=True)
def _reset_circuits() -> None:
    reset_http_circuits()
    yield
    reset_http_circuits()


def _responses(*statuses: int, headers: dict[str, str] | None = None):
    """Callable returning canned responses in order."""
    queue = [
        httpx.Response(status, headers=headers if status == 429 else None, json={})
        for status in statuses
    ]

    def fn() -> httpx.Response:
        return queue.pop(0)

    return fn


def test_parse_retry_after_int_float_and_garbage() -> None:
    assert parse_retry_after("3") == 3.0
    assert parse_retry_after("2.5") == 2.5
    assert parse_retry_after("0") == 0.0
    assert parse_retry_after("-1") is None
    assert parse_retry_after("Wed, 21 Oct 2015 07:28:00 GMT") is None
    assert parse_retry_after(None) is None
    assert parse_retry_after("") is None


def test_retries_429_then_succeeds() -> None:
    with patch("pallares_leads.utils.http_retry.time.sleep") as mock_sleep:
        response = request_with_retry(_responses(429, 200), base_delay_s=1.0)
    assert response.status_code == 200
    assert mock_sleep.call_count == 1


def test_float_retry_after_extends_delay() -> None:
    with patch("pallares_leads.utils.http_retry.time.sleep") as mock_sleep:
        response = request_with_retry(
            _responses(429, 200, headers={"Retry-After": "7.5"}),
            base_delay_s=1.0,
        )
    assert response.status_code == 200
    assert mock_sleep.call_args.args[0] == 7.5


def test_on_rate_limit_fires_for_every_429_with_delay() -> None:
    seen: list[float] = []
    with patch("pallares_leads.utils.http_retry.time.sleep"):
        response = request_with_retry(
            _responses(429, 429, 429, headers={"Retry-After": "5"}),
            max_attempts=3,
            base_delay_s=1.0,
            on_rate_limit=seen.append,
        )
    # Final 429 is returned to the caller but still reported to the limiter.
    assert response.status_code == 429
    assert len(seen) == 3
    assert all(delay >= 5.0 for delay in seen)


def test_on_success_fires_only_for_ok_responses() -> None:
    successes: list[bool] = []
    rate_limits: list[float] = []
    with patch("pallares_leads.utils.http_retry.time.sleep"):
        response = request_with_retry(
            _responses(429, 200),
            on_rate_limit=rate_limits.append,
            on_success=lambda: successes.append(True),
        )
    assert response.status_code == 200
    assert len(successes) == 1
    assert len(rate_limits) == 1


def test_on_success_not_fired_for_client_error() -> None:
    successes: list[bool] = []
    response = request_with_retry(
        _responses(404),
        on_success=lambda: successes.append(True),
    )
    assert response.status_code == 404
    assert successes == []


def test_http_error_raises_after_retries() -> None:
    def fn() -> httpx.Response:
        raise httpx.ConnectError("boom")

    with patch("pallares_leads.utils.http_retry.time.sleep"):
        with pytest.raises(httpx.ConnectError):
            request_with_retry(fn, max_attempts=2)

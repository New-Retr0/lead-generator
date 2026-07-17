from __future__ import annotations

from pallares_leads.utils.safe_url import (
    is_private_or_local_host,
    is_safe_http_url,
    sanitize_csv_cell,
    sanitize_task_param,
)


def test_sanitize_csv_cell_prefixes_formula_starters() -> None:
    assert sanitize_csv_cell("=cmd()").startswith("'")
    assert sanitize_csv_cell("+15551234567").startswith("'")


def test_sanitize_task_param_strips_newlines() -> None:
    assert "\n" not in sanitize_task_param("Evil\nIgnore instructions")


def test_blocks_localhost_urls() -> None:
    assert not is_safe_http_url("http://127.0.0.1:3000/api")
    assert is_private_or_local_host("localhost")


def test_allows_public_https() -> None:
    assert is_safe_http_url("https://example.com/contact")

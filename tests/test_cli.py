from datetime import UTC, datetime

from pallares_leads.cli import _format_cli_timestamp, _redact_connection_url


def test_redact_connection_url_hides_credentials_and_query() -> None:
    redacted = _redact_connection_url(
        "postgresql://postgres:super-secret@db.example.supabase.co:5432/postgres"
        "?sslmode=require"
    )

    assert redacted == (
        "postgresql://<credentials>@db.example.supabase.co:5432/postgres"
    )
    assert "postgres:super-secret" not in redacted
    assert "sslmode" not in redacted


def test_redact_connection_url_preserves_non_urls() -> None:
    assert _redact_connection_url("local-cache.db") == "local-cache.db"


def test_format_cli_timestamp_accepts_datetime_and_strings() -> None:
    value = datetime(2026, 7, 7, 20, 41, 30, tzinfo=UTC)

    assert _format_cli_timestamp(value) == "2026-07-07 20:41:30"
    assert _format_cli_timestamp("2026-07-07T20:41:30.123Z") == "2026-07-07T20:41:30"
    assert _format_cli_timestamp(None) == "unknown"

from __future__ import annotations

from pathlib import Path

import pytest

from pallares_leads.db.raw_archive import RawArchive, record_capture, reset_raw_archive_for_tests
from pallares_leads.settings import Settings


@pytest.fixture(autouse=True)
def _reset_archive_singleton() -> None:
    reset_raw_archive_for_tests()


@pytest.fixture
def archive_path(tmp_path: Path) -> Path:
    return tmp_path / "raw_archive.db"


def test_compress_round_trip(archive_path: Path) -> None:
    archive = RawArchive(archive_path)
    payload = {"places": [{"id": "abc", "rating": 4.2, "reviews": ["a" * 100]}]}
    assert archive.record_capture("google_places", "text_search", response=payload) is True

    row = archive._conn.execute(
        "SELECT response_blob FROM raw_captures WHERE provider = 'google_places'"
    ).fetchone()
    assert row is not None
    decoded = archive.decode_response(row["response_blob"])
    assert decoded == payload
    archive.close()


def test_dedupe_same_sha256(archive_path: Path) -> None:
    archive = RawArchive(archive_path)
    payload = {"query": "gas station", "places": []}
    assert archive.record_capture(
        "google_places",
        "text_search",
        place_id="ChIJtest",
        response=payload,
    )
    assert (
        archive.record_capture(
            "google_places",
            "text_search",
            place_id="ChIJtest",
            response=payload,
        )
        is False
    )

    count = archive._conn.execute("SELECT COUNT(*) AS n FROM raw_captures").fetchone()
    assert int(count["n"]) == 1
    archive.close()


def test_truncates_large_responses(archive_path: Path) -> None:
    archive = RawArchive(archive_path)
    huge = {"data": "x" * 5000}
    archive.record_capture("firecrawl", "scrape", response=huge, max_bytes=512)
    row = archive._conn.execute("SELECT response_blob FROM raw_captures").fetchone()
    decoded = archive.decode_response(row["response_blob"])
    assert decoded.get("_truncated") is True
    archive.close()


def test_record_capture_respects_settings(tmp_path: Path) -> None:
    settings = Settings(
        data_dir=tmp_path,
        raw_archive_path=tmp_path / "archive.db",
        raw_capture_enabled=False,
    )
    assert (
        record_capture(settings, "overpass", "interpreter", response={"elements": []}) is False
    )

    settings = Settings(
        data_dir=tmp_path,
        raw_archive_path=tmp_path / "archive2.db",
        raw_capture_enabled=True,
    )
    assert record_capture(settings, "overpass", "interpreter", response={"elements": []}) is True
    archive = RawArchive(settings.raw_archive_path)
    stats = archive.stats()
    assert stats["total_count"] == 1
    archive.close()

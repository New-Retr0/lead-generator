#!/usr/bin/env python3
"""Compare row counts: SQLite vs Supabase."""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import psycopg  # noqa: E402

from pallares_leads.settings import get_settings  # noqa: E402

TABLES = [
    "leads",
    "runs",
    "enrichment_profiles",
    "sales_feedback",
    "run_events",
    "cost_events",
    "credit_snapshots",
    "lead_requests",
    "request_leads",
    "lead_facts",
    "owner_records",
    "app_state",
]


def main() -> int:
    settings = get_settings()
    sqlite_path = settings.data_dir / "pallares.db"
    pg_url = settings.supabase_db_url
    if not pg_url:
        print("SUPABASE_DB_URL required", file=sys.stderr)
        return 1

    src = sqlite3.connect(str(sqlite_path))
    print(f"SQLite: {sqlite_path} ({sqlite_path.stat().st_size:,} bytes)\n")
    print(f"{'table':<22} {'sqlite':>10} {'supabase':>10} {'delta':>10}")
    print("-" * 56)

    with psycopg.connect(pg_url, prepare_threshold=None) as dst:
        for table in TABLES:
            try:
                sq = src.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            except sqlite3.OperationalError:
                sq = -1
            try:
                with dst.cursor() as cur:
                    cur.execute(f"SELECT COUNT(*) FROM {table}")
                    pg = cur.fetchone()[0]
            except Exception:
                pg = -1
            delta = pg - sq if sq >= 0 and pg >= 0 else "?"
            print(f"{table:<22} {sq:>10} {pg:>10} {delta:>10}")

    # enriched_json sample
    row = src.execute(
        "SELECT COUNT(*) FROM leads WHERE enriched_json IS NOT NULL AND TRIM(enriched_json) != ''"
    ).fetchone()[0]
    print(f"\nSQLite leads with enriched_json: {row}")

    src.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

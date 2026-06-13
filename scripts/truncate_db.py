"""Truncate all application tables (use when pallares.db is locked by the dashboard)."""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "pallares.db"


def main() -> int:
    if not DB.exists():
        print(f"No database at {DB}")
        return 0
    conn = sqlite3.connect(DB)
    tables = [
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
    ]
    for table in tables:
        conn.execute(f"DELETE FROM [{table}]")
    conn.commit()
    counts = {
        table: conn.execute(f"SELECT COUNT(*) FROM [{table}]").fetchone()[0]
        for table in tables
    }
    conn.close()
    print(f"Truncated {len(tables)} tables in {DB}")
    nonzero = {k: v for k, v in counts.items() if v}
    if nonzero:
        print("WARNING: nonzero counts:", nonzero)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

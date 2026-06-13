"""Wipe all pipeline data from pallares.db (keeps schema)."""

from __future__ import annotations

import sqlite3
from pathlib import Path

DB = Path(__file__).resolve().parents[1] / "data" / "pallares.db"

TABLES = (
    "cost_events",
    "credit_snapshots",
    "domain_cache",
    "enrichment_profiles",
    "lead_facts",
    "lead_requests",
    "leads",
    "owner_records",
    "page_cache",
    "request_leads",
    "run_events",
    "runs",
    "sales_feedback",
)


def main() -> None:
    if not DB.exists():
        print(f"No database at {DB}")
        return
    con = sqlite3.connect(DB)
    for table in TABLES:
        con.execute(f"DELETE FROM {table}")
    con.execute("DELETE FROM app_state")
    con.commit()
    con.close()
    for suffix in ("-wal", "-shm"):
        sidecar = Path(str(DB) + suffix)
        if sidecar.exists():
            try:
                sidecar.unlink()
            except OSError:
                pass  # dashboard may hold WAL open
    print(f"Wiped {len(TABLES)} tables in {DB}")


if __name__ == "__main__":
    main()

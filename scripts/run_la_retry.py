"""Re-run Los Angeles client categories (single process, parallel leads)."""

from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "pallares.db"

ENV = {
    "OWNER_CHAIN_MAX_PER_RUN": "3",
}

LA_CATS = (
    "strip_mall",
    "shopping_center",
    "medical_plaza",
    "hotel",
    "auto_dealer",
    "industrial",
)


def checkpoint(label: str) -> None:
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    credits = float(
        con.execute(
            "SELECT COALESCE(SUM(units),0) n FROM cost_events WHERE provider='firecrawl'"
        ).fetchone()["n"]
    )
    usd = float(con.execute("SELECT COALESCE(SUM(usd),0) n FROM cost_events").fetchone()["n"])
    la = int(
        con.execute("SELECT COUNT(*) n FROM leads WHERE market_key='los_angeles'").fetchone()["n"]
    )
    con.close()
    print(f"[{label}] credits={credits:.0f} usd=${usd:.2f} la_leads={la}")


def main() -> int:
    checkpoint("start")
    env = os.environ.copy()
    env.update(ENV)
    for cat in LA_CATS:
        cmd = [
            sys.executable,
            "-m",
            "pallares_leads.cli",
            "run",
            "--market",
            "los_angeles",
            "--category",
            cat,
            "--limit",
            "10",
        ]
        print("\n>>>", " ".join(cmd[2:]))
        code = subprocess.call(cmd, cwd=ROOT, env=env)
        if code != 0:
            print(f"Warning: {cat} exited {code}")
        checkpoint(cat)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

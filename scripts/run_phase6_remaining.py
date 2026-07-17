"""Phase 6 population runs with budget stop rule."""

from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "pallares.db"

ENV = {
    "FIRECRAWL_MAX_CREDITS_PER_RUN": "600",
    "OWNER_CHAIN_MAX_PER_RUN": "3",
    "LOOPNET_MAX_PER_RUN": "2",
}

STOP_CREDITS = 2800
STOP_USD = 40.0

LA_OC_CATS = (
    "strip_mall",
    "shopping_center",
    "medical_plaza",
    "hotel",
    "auto_dealer",
    "industrial",
)

VENDOR_MARKETS = ("las_vegas", "albuquerque", "kansas_city")


def checkpoint(label: str) -> tuple[float, float, int]:
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    credits = float(
        con.execute(
            "SELECT COALESCE(SUM(units),0) n FROM cost_events WHERE provider='firecrawl'"
        ).fetchone()["n"]
    )
    usd = float(con.execute("SELECT COALESCE(SUM(usd),0) n FROM cost_events").fetchone()["n"])
    leads = int(con.execute("SELECT COUNT(*) n FROM leads").fetchone()["n"])
    con.close()
    print(
        f"[checkpoint:{label}] firecrawl_credits={credits:.0f}  "
        f"tracked_usd=${usd:.2f}  leads={leads}"
    )
    return credits, usd, leads


def over_budget(credits: float, usd: float) -> bool:
    if credits > STOP_CREDITS or usd > STOP_USD:
        print(f"STOP: credits={credits:.0f} usd=${usd:.2f} — skipping remaining runs")
        return True
    return False


def run_cmd(args: list[str]) -> int:
    env = os.environ.copy()
    env.update(ENV)
    print(f"\n>>> {' '.join(args)}")
    return subprocess.call(args, cwd=ROOT, env=env)


def main() -> int:
    steps: list[tuple[str, list[str]]] = []

    for cat in LA_OC_CATS:
        steps.append(
            (
                f"la_{cat}",
                [
                    "python",
                    "-m",
                    "pallares_leads.cli",
                    "run",
                    "--market",
                    "los_angeles",
                    "--category",
                    cat,
                    "--limit",
                    "10",
                ],
            )
        )
    for cat in LA_OC_CATS:
        steps.append(
            (
                f"oc_{cat}",
                [
                    "python",
                    "-m",
                    "pallares_leads.cli",
                    "run",
                    "--market",
                    "orange_county",
                    "--category",
                    cat,
                    "--limit",
                    "10",
                ],
            )
        )
    for market in VENDOR_MARKETS:
        steps.append(
            (
                f"vendor_{market}",
                [
                    "python",
                    "-m",
                    "pallares_leads.cli",
                    "run",
                    "--market",
                    market,
                    "--category",
                    "vendor_pressure_washing",
                    "--limit",
                    "2",
                ],
            )
        )

    credits, usd, _ = checkpoint("start")
    if over_budget(credits, usd):
        return 0

    for label, cmd in steps:
        code = run_cmd(cmd)
        if code != 0:
            print(f"Warning: {label} exited {code}")
        credits, usd, _ = checkpoint(label)
        if over_budget(credits, usd):
            return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())

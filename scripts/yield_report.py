"""Per market x category yield report: callable leads and cost per callable."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

DB = Path(__file__).resolve().parents[1] / "data" / "pallares.db"


def _callable(enriched_json: str | None) -> bool:
    if not enriched_json:
        return False
    try:
        data = json.loads(enriched_json)
    except (ValueError, TypeError):
        return False
    for contact in data.get("site_contacts") or []:
        phone = (contact.get("phone") or "").strip()
        verification = contact.get("verification") or ""
        if phone and phone != "Not found" and verification in ("verified", "corroborated"):
            return True
    best = (data.get("best_contact_phone") or "").strip()
    return bool(best and best != "Not found")


def main() -> None:
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT place_id, market_key, category_key, lead_score, enriched_json FROM leads"
    ).fetchall()
    costs = {
        str(r["place_id"]): float(r["usd"])
        for r in con.execute(
            "SELECT place_id, COALESCE(SUM(usd),0) usd FROM cost_events "
            "WHERE place_id IS NOT NULL GROUP BY place_id"
        )
    }
    buckets: dict[tuple[str, str], dict[str, float]] = {}
    for row in rows:
        key = (row["market_key"] or "?", row["category_key"] or "?")
        b = buckets.setdefault(key, {"leads": 0, "callable": 0, "usd": 0.0, "score": 0.0})
        b["leads"] += 1
        b["usd"] += costs.get(str(row["place_id"]), 0.0)
        b["score"] += row["lead_score"] or 0
        if _callable(row["enriched_json"]):
            b["callable"] += 1

    print(
        f"{'market':<16}{'category':<26}{'leads':>6}{'callable':>9}{'rate':>7}"
        f"{'avg score':>10}{'usd':>8}{'usd/callable':>14}"
    )
    for (market, category), b in sorted(buckets.items()):
        leads = int(b["leads"])
        ok = int(b["callable"])
        rate = ok / leads if leads else 0.0
        per = b["usd"] / ok if ok else 0.0
        print(
            f"{market:<16}{category:<26}{leads:>6}{ok:>9}{rate:>7.0%}"
            f"{b['score'] / leads if leads else 0:>10.0f}{b['usd']:>8.2f}{per:>14.2f}"
        )
    total_usd = sum(b["usd"] for b in buckets.values())
    print(f"\nTOTAL tracked USD: ${total_usd:.2f}  (budget: $50.00)")


if __name__ == "__main__":
    main()

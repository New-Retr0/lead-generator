"""Print acceptance checks for Jaber Motors ground truth."""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "pallares.db"
JABER_PLACE = "ChIJVVVprevilIAR4xyj6PWAv6Y"


def main() -> int:
    if not DB.exists():
        print("FAIL: no database")
        return 1
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row

    leads = conn.execute(
        "SELECT place_id, business_name, enriched_json FROM leads WHERE enriched_json IS NOT NULL"
    ).fetchall()
    print(f"enriched leads: {len(leads)}")
    for row in leads:
        payload = json.loads(row["enriched_json"])
        print(
            f"  - {row['business_name']}: verification={payload.get('verification_level')} "
            f"contact={payload.get('best_contact_name')}"
        )

    jaber = conn.execute(
        "SELECT enriched_json FROM leads WHERE place_id = ? OR business_name LIKE '%Jaber%'",
        (JABER_PLACE,),
    ).fetchone()

    costs = conn.execute(
        "SELECT provider, COUNT(*), ROUND(SUM(usd), 4) FROM cost_events GROUP BY provider"
    ).fetchall()
    print("cost_events:", costs or "NONE")

    ok = True
    if not costs:
        print("FAIL: no cost_events")
        ok = False

    if not jaber:
        print("WARN: Jaber Motors not enriched yet")
        return 0 if ok else 1

    payload = json.loads(jaber["enriched_json"])
    contacts = json.dumps(payload.get("site_contacts", []))
    if "John Doe" in contacts:
        print("FAIL: John Doe still present")
        ok = False
    if "Jaber" in (payload.get("best_contact_name") or "") or "Ahmad" in contacts:
        print("OK: Jaber principal found")
    else:
        print("WARN: Ahmad A. Jaber not in best contact yet")

    facts = conn.execute(
        "SELECT fact_kind, value_json, source_kind FROM lead_facts WHERE place_id = ?",
        (JABER_PLACE,),
    ).fetchall()
    bbb = [f for f in facts if f["source_kind"] == "bbb"]
    socials = [f for f in facts if f["fact_kind"] == "social"]
    print(f"jaber facts: bbb={len(bbb)} social={len(socials)} total={len(facts)}")
    print(f"verification_level: {payload.get('verification_level')}")

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())

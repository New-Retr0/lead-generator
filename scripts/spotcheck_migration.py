#!/usr/bin/env python3
"""Spot-check enriched_json and cost data between SQLite and Supabase."""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import psycopg  # noqa: E402
from psycopg.rows import dict_row  # noqa: E402

from pallares_leads.settings import get_settings  # noqa: E402


def _top_keys(blob: str | dict | None) -> list[str]:
    if not blob:
        return []
    if isinstance(blob, str):
        try:
            data = json.loads(blob)
        except json.JSONDecodeError:
            return ["<invalid json>"]
    else:
        data = blob
    if not isinstance(data, dict):
        return [type(data).__name__]
    return sorted(data.keys())[:20]


def main() -> int:
    settings = get_settings()
    sqlite_path = settings.data_dir / "pallares.db"
    pg_url = settings.supabase_db_url
    src = sqlite3.connect(str(sqlite_path))
    src.row_factory = sqlite3.Row

    with psycopg.connect(pg_url, prepare_threshold=None, row_factory=dict_row) as dst:
        sq_leads = src.execute(
            "SELECT place_id, business_name, credits_total, enriched_json FROM leads ORDER BY credits_total DESC NULLS LAST LIMIT 5"
        ).fetchall()

        print("=== Top 5 leads by credits_total (SQLite) ===")
        for r in sq_leads:
            pid = r["place_id"]
            with dst.cursor() as cur:
                cur.execute(
                    "SELECT place_id, credits_total, enriched_json FROM leads WHERE place_id = %s",
                    (pid,),
                )
                pg = cur.fetchone()
            sq_keys = _top_keys(r["enriched_json"])
            pg_keys = _top_keys(pg["enriched_json"] if pg else None)
            sq_credits = r["credits_total"]
            pg_credits = pg["credits_total"] if pg else None
            print(f"\n{pid[:20]}... {r['business_name'][:40]}")
            print(f"  credits_total  sqlite={sq_credits}  pg={pg_credits}")
            print(f"  enriched keys  sqlite={sq_keys}")
            print(f"  enriched keys  pg={pg_keys}")
            if r["enriched_json"] and pg and pg["enriched_json"]:
                sq_data = json.loads(r["enriched_json"]) if isinstance(r["enriched_json"], str) else r["enriched_json"]
                pg_data = pg["enriched_json"]
                for key in ("contacts", "phone", "decision_maker", "why_call", "talking_points", "cost_usd"):
                    sq_val = sq_data.get(key) if isinstance(sq_data, dict) else None
                    pg_val = pg_data.get(key) if isinstance(pg_data, dict) else None
                    if sq_val or pg_val:
                        print(f"  {key}: sqlite={bool(sq_val)} pg={bool(pg_val)}")

        print("\n=== Cost totals ===")
        sq_cost = src.execute("SELECT SUM(usd), SUM(units), COUNT(*) FROM cost_events").fetchone()
        with dst.cursor() as cur:
            cur.execute("SELECT SUM(usd), SUM(units), COUNT(*) FROM cost_events")
            pg_cost = cur.fetchone()
        print(f"SQLite:  count={sq_cost[2]} units={sq_cost[1]} usd={sq_cost[0]}")
        print(f"Postgres: count={pg_cost['count']} units={pg_cost['sum']} usd={pg_cost['sum']}")

        # fix query
        with dst.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS c, COALESCE(SUM(units),0) AS units, COALESCE(SUM(usd),0) AS usd FROM cost_events")
            pg_cost = cur.fetchone()
        print(f"SQLite:  count={sq_cost[2]} units={sq_cost[1]} usd={sq_cost[0]}")
        print(f"Postgres: count={pg_cost['c']} units={pg_cost['units']} usd={pg_cost['usd']}")

        # missing cost_events
        sq_ids = {r[0] for r in src.execute("SELECT id FROM cost_events").fetchall()}
        with dst.cursor() as cur:
            cur.execute("SELECT id FROM cost_events")
            pg_ids = {r["id"] for r in cur.fetchall()}
        print(f"\nSQLite cost_events ids: {len(sq_ids)}, Postgres ids: {len(pg_ids)}")
        print("(Postgres uses new identity ids — compare by content instead)")

        sq_rows = src.execute(
            "SELECT run_id, place_id, provider, operation, units, usd FROM cost_events"
        ).fetchall()
        with dst.cursor() as cur:
            cur.execute("SELECT run_id, place_id, provider, operation, units, usd FROM cost_events")
            pg_rows = cur.fetchall()
        sq_set = {(r[0], r[1], r[2], r[3], r[4], r[5]) for r in sq_rows}
        pg_set = {(r["run_id"], r["place_id"], r["provider"], r["operation"], r["units"], r["usd"]) for r in pg_rows}
        print(f"Missing in pg: {len(sq_set - pg_set)}")
        print(f"Extra in pg: {len(pg_set - sq_set)}")

    src.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

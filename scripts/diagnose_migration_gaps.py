#!/usr/bin/env python3
"""Find why SQLite rows did not land in Supabase."""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import psycopg  # noqa: E402
from psycopg.rows import dict_row  # noqa: E402

from pallares_leads.settings import get_settings  # noqa: E402


def main() -> int:
    settings = get_settings()
    src = sqlite3.connect(str(settings.data_dir / "pallares.db"))
    src.row_factory = sqlite3.Row

    with psycopg.connect(settings.supabase_db_url, prepare_threshold=None, row_factory=dict_row) as dst:
        lead_ids = {r[0] for r in src.execute("SELECT place_id FROM leads").fetchall()}
        with dst.cursor() as cur:
            cur.execute("SELECT place_id FROM leads")
            pg_lead_ids = {r["place_id"] for r in cur.fetchall()}

        # run_events missing
        sq_re = src.execute(
            "SELECT run_id, place_id, stage, created_at FROM run_events"
        ).fetchall()
        with dst.cursor() as cur:
            cur.execute("SELECT run_id, place_id, stage, created_at FROM run_events")
            pg_re = cur.fetchall()

        sq_set = {(r["run_id"], r["place_id"], r["stage"], r["created_at"]) for r in sq_re}
        pg_set = {(r["run_id"], r["place_id"], r["stage"], r["created_at"]) for r in pg_re}
        missing_re = sq_set - pg_set
        print(f"run_events missing: {len(missing_re)}")
        orphan_re = [r for r in sq_re if str(r["place_id"]) not in lead_ids]
        print(f"run_events orphan place_ids (not in sqlite leads): {len(orphan_re)}")
        filtered_re = [r for r in sq_re if str(r["place_id"]) not in lead_ids]
        print(f"would be filtered by migration script: {len(filtered_re)}")

        # cost_events missing
        sq_ce = src.execute(
            "SELECT run_id, place_id, provider, operation, units, usd, created_at FROM cost_events"
        ).fetchall()
        with dst.cursor() as cur:
            cur.execute(
                "SELECT run_id, place_id, provider, operation, units, usd, created_at FROM cost_events"
            )
            pg_ce = cur.fetchall()
        sq_ce_set = {
            (r["run_id"], r["place_id"], r["provider"], r["operation"], r["units"], r["usd"], r["created_at"])
            for r in sq_ce
        }
        pg_ce_set = {
            (r["run_id"], r["place_id"], r["provider"], r["operation"], r["units"], r["usd"], r["created_at"])
            for r in pg_ce
        }
        missing_ce = sq_ce_set - pg_ce_set
        print(f"\ncost_events missing: {len(missing_ce)}")
        filtered_ce = [
            r for r in sq_ce if r["place_id"] is not None and str(r["place_id"]) not in lead_ids
        ]
        print(f"cost_events with orphan place_id: {len(filtered_ce)}")

        # lead_facts
        sq_lf = src.execute(
            "SELECT place_id, fact_kind, source_kind, observed_at FROM lead_facts"
        ).fetchall()
        with dst.cursor() as cur:
            cur.execute("SELECT place_id, fact_kind, source_kind, observed_at FROM lead_facts")
            pg_lf = cur.fetchall()
        sq_lf_set = {(r["place_id"], r["fact_kind"], r["source_kind"], r["observed_at"]) for r in sq_lf}
        pg_lf_set = {(r["place_id"], r["fact_kind"], r["source_kind"], r["observed_at"]) for r in pg_lf}
        print(f"\nlead_facts missing: {len(sq_lf_set - pg_lf_set)}")
        orphan_lf = [r for r in sq_lf if str(r["place_id"]) not in lead_ids]
        print(f"lead_facts orphan place_ids: {len(orphan_lf)}")

        # site_contacts in enriched_json
        with_contacts = 0
        with_best = 0
        for row in src.execute("SELECT enriched_json FROM leads").fetchall():
            import json

            data = json.loads(row[0]) if row[0] else {}
            if data.get("site_contacts"):
                with_contacts += 1
            if data.get("best_contact_phone"):
                with_best += 1
        print(f"\nSQLite leads with site_contacts: {with_contacts}/236")
        print(f"SQLite leads with best_contact_phone: {with_best}/236")

    src.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

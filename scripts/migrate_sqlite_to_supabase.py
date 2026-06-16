#!/usr/bin/env python3
"""One-time / repeat migration: SQLite data/pallares.db -> Supabase Postgres."""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

import psycopg
from psycopg.types.json import Json

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from pallares_leads.settings import get_settings  # noqa: E402


def _bool(val: object) -> bool | None:
    if val is None:
        return None
    return bool(int(val))


def _json_val(val: object) -> object | None:
    if val is None:
        return None
    if isinstance(val, (dict, list)):
        return Json(val)
    text = str(val).strip()
    if not text:
        return None
    return Json(json.loads(text))


TABLES_IN_ORDER: list[tuple[str, list[str]]] = [
    (
        "leads",
        [
            "place_id",
            "business_name",
            "market_key",
            "category_key",
            "city",
            "first_seen_at",
            "last_seen_at",
            "last_enriched_at",
            "last_run_id",
            "enrichment_status",
            "confidence",
            "source_tool",
            "csv_path",
            "profile_key",
            "enriched_json",
            "credits_total",
            "lead_score",
            "request_id",
        ],
    ),
    (
        "runs",
        [
            "run_id",
            "started_at",
            "finished_at",
            "run_type",
            "market_key",
            "category_key",
            "campaign_key",
            "discovered_count",
            "skipped_known_count",
            "enriched_count",
            "status",
        ],
    ),
    (
        "enrichment_profiles",
        [
            "profile_key",
            "property_type",
            "site_kind",
            "brand",
            "playbook_json",
            "success_count",
            "sample_place_id",
            "first_learned_at",
            "last_used_at",
        ],
    ),
    (
        "sales_feedback",
        [
            "place_id",
            "addressed",
            "feedback_notes",
            "sales_ready",
            "status",
            "assigned_to",
            "updated_at",
        ],
    ),
    (
        "run_events",
        [
            "run_id",
            "place_id",
            "stage",
            "ran",
            "reason",
            "credits_est",
            "duration_ms",
            "meta_json",
            "created_at",
        ],
    ),
    (
        "cost_events",
        [
            "run_id",
            "request_id",
            "place_id",
            "provider",
            "operation",
            "units",
            "unit_type",
            "usd",
            "model",
            "meta_json",
            "created_at",
        ],
    ),
    (
        "credit_snapshots",
        [
            "provider",
            "remaining_credits",
            "used_credits",
            "snapshot_json",
            "created_at",
        ],
    ),
    (
        "lead_requests",
        [
            "request_id",
            "created_at",
            "raw_prompt",
            "spec_json",
            "status",
            "leads_delivered",
            "credits_spent",
            "usd_spent",
            "output_path",
        ],
    ),
    (
        "request_leads",
        ["request_id", "place_id", "rank", "score"],
    ),
    (
        "lead_facts",
        [
            "place_id",
            "fact_kind",
            "value_json",
            "source_kind",
            "source_url",
            "method",
            "quote",
            "verification",
            "run_id",
            "observed_at",
        ],
    ),
    (
        "owner_records",
        [
            "place_id",
            "apn",
            "owner_name",
            "owner_name_normalized",
            "owner_kind",
            "sos_entity_number",
            "registered_agent",
            "principals_json",
            "mailing_address",
            "broker_json",
            "source",
            "created_at",
            "updated_at",
        ],
    ),
    ("app_state", ["key", "value", "updated_at"]),
]

JSON_COLS = {
    "enriched_json",
    "playbook_json",
    "meta_json",
    "snapshot_json",
    "spec_json",
    "value_json",
    "principals_json",
    "broker_json",
}
BOOL_COLS = {"addressed", "sales_ready", "ran", "is_valid"}

LEAD_UPSERT_COLS = [
    c for c in TABLES_IN_ORDER[0][1] if c != "place_id"
]

RUN_UPSERT_COLS = [c for c in TABLES_IN_ORDER[1][1] if c != "run_id"]


def row_to_tuple(columns: list[str], row: sqlite3.Row) -> tuple:
    out = []
    for col in columns:
        val = row[col]
        if col in BOOL_COLS:
            out.append(_bool(val))
        elif col in JSON_COLS:
            out.append(_json_val(val))
        else:
            out.append(val)
    return tuple(out)


def _existing_cost_keys(cur: psycopg.Cursor) -> set[tuple]:
    cur.execute(
        """
        SELECT run_id, place_id, provider, operation, units, usd, created_at
        FROM cost_events
        """
    )
    return {
        (
            r[0],
            r[1],
            r[2],
            r[3],
            float(r[4]) if r[4] is not None else 0.0,
            float(r[5]) if r[5] is not None else None,
            r[6].isoformat() if hasattr(r[6], "isoformat") else str(r[6]),
        )
        for r in cur.fetchall()
    }


def _existing_run_event_keys(cur: psycopg.Cursor) -> set[tuple]:
    cur.execute(
        """
        SELECT run_id, place_id, stage, created_at
        FROM run_events
        """
    )
    return {
        (
            r[0],
            r[1],
            r[2],
            r[3].isoformat() if hasattr(r[3], "isoformat") else str(r[3]),
        )
        for r in cur.fetchall()
    }


def _existing_lead_fact_keys(cur: psycopg.Cursor) -> set[tuple]:
    cur.execute(
        """
        SELECT place_id, fact_kind, source_kind, observed_at
        FROM lead_facts
        """
    )
    return {
        (
            r[0],
            r[1],
            r[2],
            r[3].isoformat() if hasattr(r[3], "isoformat") else str(r[3]),
        )
        for r in cur.fetchall()
    }


def migrate(sqlite_path: Path, pg_url: str) -> None:
    if not sqlite_path.is_file():
        print(f"No SQLite file at {sqlite_path} — nothing to migrate.")
        return

    src = sqlite3.connect(str(sqlite_path))
    src.row_factory = sqlite3.Row
    lead_ids = {str(r[0]) for r in src.execute("SELECT place_id FROM leads").fetchall()}

    with psycopg.connect(pg_url, prepare_threshold=None) as dst:
        for table, columns in TABLES_IN_ORDER:
            try:
                rows = src.execute(f"SELECT {', '.join(columns)} FROM {table}").fetchall()
            except sqlite3.OperationalError:
                print(f"  skip {table} (not in SQLite)")
                continue
            if not rows:
                print(f"  {table}: 0 rows")
                continue

            payloads = [row_to_tuple(columns, r) for r in rows]
            placeholders = ", ".join("%s" for _ in columns)
            col_list = ", ".join(columns)

            with dst.cursor() as cur:
                if table == "leads":
                    updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in LEAD_UPSERT_COLS)
                    sql = (
                        f"INSERT INTO {table} ({col_list}) VALUES ({placeholders}) "
                        f"ON CONFLICT (place_id) DO UPDATE SET {updates}"
                    )
                    cur.executemany(sql, payloads)
                    inserted = len(payloads)
                elif table == "runs":
                    updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in RUN_UPSERT_COLS)
                    sql = (
                        f"INSERT INTO {table} ({col_list}) VALUES ({placeholders}) "
                        f"ON CONFLICT (run_id) DO UPDATE SET {updates}"
                    )
                    cur.executemany(sql, payloads)
                    inserted = len(payloads)
                elif table == "enrichment_profiles":
                    updates = ", ".join(
                        f"{c} = EXCLUDED.{c}"
                        for c in columns
                        if c != "profile_key"
                    )
                    sql = (
                        f"INSERT INTO {table} ({col_list}) VALUES ({placeholders}) "
                        f"ON CONFLICT (profile_key) DO UPDATE SET {updates}"
                    )
                    cur.executemany(sql, payloads)
                    inserted = len(payloads)
                elif table == "sales_feedback":
                    # Only migrate SQLite rows; do not overwrite rep CRM updates in Postgres.
                    existing = {
                        r[0]
                        for r in cur.execute(
                            "SELECT place_id FROM sales_feedback WHERE status != 'New' OR addressed = true OR feedback_notes IS NOT NULL"
                        ).fetchall()
                    }
                    to_insert = [
                        p
                        for p, r in zip(payloads, rows)
                        if str(r["place_id"]) not in existing
                    ]
                    if to_insert:
                        sql = (
                            f"INSERT INTO {table} ({col_list}) VALUES ({placeholders}) "
                            "ON CONFLICT (place_id) DO NOTHING"
                        )
                        cur.executemany(sql, to_insert)
                    inserted = len(to_insert)
                elif table == "cost_events":
                    existing = _existing_cost_keys(cur)
                    to_insert = []
                    skipped_orphan = 0
                    skipped_dup = 0
                    for p, r in zip(payloads, rows):
                        place_id = r["place_id"]
                        if place_id is not None and str(place_id) not in lead_ids:
                            # Nullable FK — keep spend even when lead row was pruned from SQLite.
                            p = list(p)
                            idx = columns.index("place_id")
                            p[idx] = None
                            skipped_orphan += 1
                        key = (
                            r["run_id"],
                            None if place_id is None or str(place_id) not in lead_ids else place_id,
                            r["provider"],
                            r["operation"],
                            float(r["units"]) if r["units"] is not None else 0.0,
                            float(r["usd"]) if r["usd"] is not None else None,
                            str(r["created_at"]),
                        )
                        if key in existing:
                            skipped_dup += 1
                            continue
                        to_insert.append(tuple(p))
                    if to_insert:
                        sql = f"INSERT INTO {table} ({col_list}) VALUES ({placeholders})"
                        cur.executemany(sql, to_insert)
                    inserted = len(to_insert)
                    if skipped_orphan:
                        print(f"    ({skipped_orphan} cost rows kept with place_id=null)")
                    if skipped_dup:
                        print(f"    ({skipped_dup} duplicates skipped)")
                elif table == "run_events":
                    existing = _existing_run_event_keys(cur)
                    to_insert = []
                    skipped_orphan = 0
                    skipped_dup = 0
                    for p, r in zip(payloads, rows):
                        if str(r["place_id"]) not in lead_ids:
                            skipped_orphan += 1
                            continue
                        key = (r["run_id"], r["place_id"], r["stage"], str(r["created_at"]))
                        if key in existing:
                            skipped_dup += 1
                            continue
                        to_insert.append(p)
                    if to_insert:
                        sql = f"INSERT INTO {table} ({col_list}) VALUES ({placeholders})"
                        cur.executemany(sql, to_insert)
                    inserted = len(to_insert)
                    if skipped_orphan:
                        print(f"    ({skipped_orphan} orphan run_events skipped — no lead row)")
                    if skipped_dup:
                        print(f"    ({skipped_dup} duplicates skipped)")
                elif table == "lead_facts":
                    existing = _existing_lead_fact_keys(cur)
                    to_insert = []
                    skipped_orphan = 0
                    skipped_dup = 0
                    for p, r in zip(payloads, rows):
                        if str(r["place_id"]) not in lead_ids:
                            skipped_orphan += 1
                            continue
                        key = (
                            r["place_id"],
                            r["fact_kind"],
                            r["source_kind"],
                            str(r["observed_at"]),
                        )
                        if key in existing:
                            skipped_dup += 1
                            continue
                        to_insert.append(p)
                    if to_insert:
                        sql = f"INSERT INTO {table} ({col_list}) VALUES ({placeholders})"
                        cur.executemany(sql, to_insert)
                    inserted = len(to_insert)
                    if skipped_orphan:
                        print(f"    ({skipped_orphan} orphan lead_facts skipped — no lead row)")
                    if skipped_dup:
                        print(f"    ({skipped_dup} duplicates skipped)")
                elif table == "owner_records":
                    updates = ", ".join(
                        f"{c} = EXCLUDED.{c}" for c in columns if c != "place_id"
                    )
                    sql = (
                        f"INSERT INTO {table} ({col_list}) VALUES ({placeholders}) "
                        f"ON CONFLICT (place_id) DO UPDATE SET {updates}"
                    )
                    cur.executemany(sql, payloads)
                    inserted = len(payloads)
                elif table == "app_state":
                    sql = (
                        f"INSERT INTO {table} ({col_list}) VALUES ({placeholders}) "
                        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "
                        "updated_at = EXCLUDED.updated_at"
                    )
                    cur.executemany(sql, payloads)
                    inserted = len(payloads)
                else:
                    sql = f"INSERT INTO {table} ({col_list}) VALUES ({placeholders}) ON CONFLICT DO NOTHING"
                    cur.executemany(sql, payloads)
                    inserted = len(payloads)

            dst.commit()
            print(f"  {table}: {inserted} rows applied")

    src.close()
    print("Migration complete.")


def main() -> int:
    settings = get_settings()
    sqlite_path = settings.data_dir / "pallares.db"
    pg_url = settings.supabase_db_url
    if not pg_url:
        print("SUPABASE_DB_URL is required", file=sys.stderr)
        return 1
    print(f"Migrating {sqlite_path} -> Supabase")
    migrate(sqlite_path, pg_url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

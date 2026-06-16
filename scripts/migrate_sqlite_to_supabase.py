#!/usr/bin/env python3
"""One-time migration: SQLite data/pallares.db -> Supabase Postgres."""

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


def migrate(sqlite_path: Path, pg_url: str) -> None:
    if not sqlite_path.is_file():
        print(f"No SQLite file at {sqlite_path} — nothing to migrate.")
        return

    src = sqlite3.connect(str(sqlite_path))
    src.row_factory = sqlite3.Row

    with psycopg.connect(pg_url, prepare_threshold=None) as dst:
        lead_ids: set[str] = set()
        for table, columns in TABLES_IN_ORDER:
            try:
                rows = src.execute(f"SELECT {', '.join(columns)} FROM {table}").fetchall()
            except sqlite3.OperationalError:
                print(f"  skip {table} (not in SQLite)")
                continue
            if not rows:
                print(f"  {table}: 0 rows")
                continue

            if table == "leads":
                lead_ids = {str(r["place_id"]) for r in rows}

            filtered = list(rows)
            if table in ("run_events", "lead_facts", "owner_records", "request_leads") and lead_ids:
                filtered = [r for r in rows if str(r["place_id"]) in lead_ids]
            if table == "cost_events" and lead_ids:
                filtered = [
                    r for r in rows if r["place_id"] is None or str(r["place_id"]) in lead_ids
                ]
            if table == "sales_feedback" and lead_ids:
                filtered = [r for r in rows if str(r["place_id"]) in lead_ids]

            placeholders = ", ".join("%s" for _ in columns)
            col_list = ", ".join(columns)
            sql = (
                f"INSERT INTO {table} ({col_list}) VALUES ({placeholders}) "
                f"ON CONFLICT DO NOTHING"
            )
            if table == "leads":
                sql = (
                    f"INSERT INTO {table} ({col_list}) VALUES ({placeholders}) "
                    "ON CONFLICT (place_id) DO NOTHING"
                )
            elif table == "sales_feedback":
                sql = (
                    f"INSERT INTO {table} ({col_list}) VALUES ({placeholders}) "
                    "ON CONFLICT (place_id) DO UPDATE SET "
                    "addressed = EXCLUDED.addressed, "
                    "feedback_notes = EXCLUDED.feedback_notes, "
                    "sales_ready = EXCLUDED.sales_ready, "
                    "status = EXCLUDED.status, "
                    "assigned_to = EXCLUDED.assigned_to, "
                    "updated_at = EXCLUDED.updated_at"
                )
            elif table == "app_state":
                sql = (
                    f"INSERT INTO {table} ({col_list}) VALUES ({placeholders}) "
                    "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "
                    "updated_at = EXCLUDED.updated_at"
                )

            payloads = [row_to_tuple(columns, r) for r in filtered]
            with dst.cursor() as cur:
                cur.executemany(sql, payloads)
            dst.commit()
            print(f"  {table}: {len(filtered)} rows")

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

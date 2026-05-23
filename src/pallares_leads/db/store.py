from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from pallares_leads.schemas import EnrichedLead, InvestigationStatus, RawLead

_SCHEMA = """
CREATE TABLE IF NOT EXISTS leads (
    place_id TEXT PRIMARY KEY,
    business_name TEXT NOT NULL,
    market_key TEXT,
    category_key TEXT,
    city TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    last_enriched_at TEXT,
    last_run_id TEXT,
    enrichment_status TEXT,
    confidence TEXT,
    source_tool TEXT,
    csv_path TEXT
);

CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    run_type TEXT NOT NULL,
    market_key TEXT,
    category_key TEXT,
    campaign_key TEXT,
    discovered_count INTEGER NOT NULL DEFAULT 0,
    skipped_known_count INTEGER NOT NULL DEFAULT 0,
    enriched_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'running'
);

CREATE INDEX IF NOT EXISTS idx_leads_last_enriched ON leads(last_enriched_at);
CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at);

CREATE TABLE IF NOT EXISTS enrichment_profiles (
    profile_key TEXT PRIMARY KEY,
    property_type TEXT NOT NULL,
    site_kind TEXT NOT NULL,
    brand TEXT NOT NULL,
    playbook_json TEXT NOT NULL,
    success_count INTEGER NOT NULL DEFAULT 0,
    sample_place_id TEXT,
    first_learned_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_profiles_property_type ON enrichment_profiles(property_type);

CREATE TABLE IF NOT EXISTS run_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    place_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    ran INTEGER NOT NULL DEFAULT 0,
    reason TEXT,
    credits_est INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    meta_json TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_run_events_run_id ON run_events(run_id);
CREATE INDEX IF NOT EXISTS idx_run_events_place_id ON run_events(place_id);

CREATE TABLE IF NOT EXISTS domain_cache (
    hostname TEXT PRIMARY KEY,
    is_valid INTEGER NOT NULL,
    checked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sales_feedback (
    place_id TEXT PRIMARY KEY,
    addressed INTEGER NOT NULL DEFAULT 0,
    feedback_notes TEXT,
    sales_ready INTEGER,
    updated_at TEXT NOT NULL
);
"""


def _utc_now() -> datetime:
    return datetime.now(tz=UTC)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


class LeadStore:
    """SQLite ledger for processed leads and run history."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        self._init_schema()

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> LeadStore:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    def _init_schema(self) -> None:
        with self._lock:
            self._conn.executescript(_SCHEMA)
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._migrate_leads_columns()
            self._conn.commit()

    def _migrate_leads_columns(self) -> None:
        cols = {row[1] for row in self._conn.execute("PRAGMA table_info(leads)").fetchall()}
        if "profile_key" not in cols:
            self._conn.execute("ALTER TABLE leads ADD COLUMN profile_key TEXT")
        if "enriched_json" not in cols:
            self._conn.execute("ALTER TABLE leads ADD COLUMN enriched_json TEXT")
        if "credits_total" not in cols:
            self._conn.execute("ALTER TABLE leads ADD COLUMN credits_total INTEGER")

    def has_lead(self, place_id: str) -> bool:
        row = self._conn.execute(
            "SELECT 1 FROM leads WHERE place_id = ?",
            (place_id,),
        ).fetchone()
        return row is not None

    def should_skip(
        self,
        place_id: str,
        *,
        skip_known: bool,
        force_refresh: bool,
        refresh_after_days: int | None,
    ) -> bool:
        if force_refresh or not skip_known:
            return False

        row = self._conn.execute(
            "SELECT last_enriched_at FROM leads WHERE place_id = ?",
            (place_id,),
        ).fetchone()
        if row is None or not row["last_enriched_at"]:
            return False

        if refresh_after_days is None:
            return True

        last_enriched = datetime.fromisoformat(row["last_enriched_at"])
        cutoff = _utc_now() - timedelta(days=refresh_after_days)
        return last_enriched >= cutoff

    def filter_new_leads(
        self,
        leads: list[RawLead],
        *,
        skip_known: bool,
        force_refresh: bool,
        refresh_after_days: int | None,
    ) -> tuple[list[RawLead], int]:
        kept: list[RawLead] = []
        skipped = 0
        for lead in leads:
            if self.should_skip(
                lead.place_id,
                skip_known=skip_known,
                force_refresh=force_refresh,
                refresh_after_days=refresh_after_days,
            ):
                skipped += 1
            else:
                kept.append(lead)
        return kept, skipped

    def touch_discovered(
        self,
        lead: RawLead,
        *,
        market_key: str,
        category_key: str,
        run_id: str,
    ) -> None:
        now = _iso(_utc_now())
        self._conn.execute(
            """
            INSERT INTO leads (
                place_id, business_name, market_key, category_key, city,
                first_seen_at, last_seen_at, last_run_id, enrichment_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(place_id) DO UPDATE SET
                business_name = excluded.business_name,
                market_key = excluded.market_key,
                category_key = excluded.category_key,
                city = excluded.city,
                last_seen_at = excluded.last_seen_at,
                last_run_id = excluded.last_run_id
            """,
            (
                lead.place_id,
                lead.business_name,
                market_key,
                category_key,
                lead.city,
                now,
                now,
                run_id,
                InvestigationStatus.DISCOVERED.value,
            ),
        )

    def upsert_enriched(
        self,
        lead: EnrichedLead,
        *,
        market_key: str,
        category_key: str,
        run_id: str,
        csv_path: str | None = None,
        profile_key: str | None = None,
        credits_total: int | None = None,
    ) -> None:
        now = _iso(_utc_now())
        enriched_json = lead.model_dump(mode="json")
        self._conn.execute(
            """
            INSERT INTO leads (
                place_id, business_name, market_key, category_key, city,
                first_seen_at, last_seen_at, last_enriched_at, last_run_id,
                enrichment_status, confidence, source_tool, csv_path, profile_key,
                enriched_json, credits_total
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(place_id) DO UPDATE SET
                business_name = excluded.business_name,
                market_key = excluded.market_key,
                category_key = excluded.category_key,
                city = excluded.city,
                last_seen_at = excluded.last_seen_at,
                last_enriched_at = excluded.last_enriched_at,
                last_run_id = excluded.last_run_id,
                enrichment_status = excluded.enrichment_status,
                confidence = excluded.confidence,
                source_tool = excluded.source_tool,
                csv_path = COALESCE(excluded.csv_path, leads.csv_path),
                profile_key = COALESCE(excluded.profile_key, leads.profile_key),
                enriched_json = excluded.enriched_json,
                credits_total = COALESCE(excluded.credits_total, leads.credits_total)
            """,
            (
                lead.place_id,
                lead.business_name,
                market_key,
                category_key,
                lead.city,
                now,
                now,
                now,
                run_id,
                lead.investigation_status.value,
                lead.confidence.value,
                lead.source_tool,
                csv_path,
                profile_key,
                json.dumps(enriched_json),
                credits_total,
            ),
        )
        self._conn.commit()

    def start_run(
        self,
        *,
        run_type: str,
        market_key: str | None = None,
        category_key: str | None = None,
        campaign_key: str | None = None,
    ) -> str:
        run_id = str(uuid.uuid4())
        self._conn.execute(
            """
            INSERT INTO runs (
                run_id, started_at, run_type, market_key, category_key, campaign_key
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                _iso(_utc_now()),
                run_type,
                market_key,
                category_key,
                campaign_key,
            ),
        )
        self._conn.commit()
        return run_id

    def finish_run(
        self,
        run_id: str,
        *,
        discovered_count: int,
        skipped_known_count: int,
        enriched_count: int,
        status: str = "completed",
    ) -> None:
        self._conn.execute(
            """
            UPDATE runs SET
                finished_at = ?,
                discovered_count = ?,
                skipped_known_count = ?,
                enriched_count = ?,
                status = ?
            WHERE run_id = ?
            """,
            (
                _iso(_utc_now()),
                discovered_count,
                skipped_known_count,
                enriched_count,
                status,
                run_id,
            ),
        )
        self._conn.commit()

    def count_leads(self) -> int:
        row = self._conn.execute("SELECT COUNT(*) AS n FROM leads").fetchone()
        return int(row["n"]) if row else 0

    def count_enriched(self) -> int:
        row = self._conn.execute(
            "SELECT COUNT(*) AS n FROM leads WHERE last_enriched_at IS NOT NULL"
        ).fetchone()
        return int(row["n"]) if row else 0

    def list_enriched_place_ids(self) -> set[str]:
        rows = self._conn.execute(
            "SELECT place_id FROM leads WHERE last_enriched_at IS NOT NULL"
        ).fetchall()
        return {str(row["place_id"]) for row in rows}

    def recent_runs(self, limit: int = 5) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            """
            SELECT run_id, started_at, finished_at, run_type, market_key, category_key,
                   discovered_count, skipped_known_count, enriched_count, status
            FROM runs
            ORDER BY started_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]

    def import_from_jsonl(self, path: Path) -> int:
        imported = 0
        with path.open(encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                data = json.loads(line)
                lead = RawLead.model_validate(data)
                market_key = lead.market_key or path.stem.split("_")[0]
                parts = path.stem.split("_")
                category_key = parts[1] if len(parts) >= 2 else ""
                if not self.has_lead(lead.place_id):
                    self.touch_discovered(
                        lead,
                        market_key=market_key,
                        category_key=category_key,
                        run_id="import",
                    )
                    imported += 1
        self._conn.commit()
        return imported

    def import_from_csv(self, path: Path, *, mark_enriched: bool = True) -> int:
        from pallares_leads.pipeline.export_csv import load_enriched_from_csv

        imported = 0
        for lead in load_enriched_from_csv(path):
            parts = path.stem.split("_")
            market_key = parts[0] if parts else ""
            category_key = parts[1] if len(parts) >= 2 else lead.lead_category
            if mark_enriched:
                self.upsert_enriched(
                    lead,
                    market_key=market_key or lead.market_key,
                    category_key=category_key,
                    run_id="import",
                    csv_path=str(path),
                )
            elif not self.has_lead(lead.place_id):
                raw = RawLead.model_validate(lead.model_dump())
                self.touch_discovered(
                    raw,
                    market_key=market_key or lead.market_key,
                    category_key=category_key,
                    run_id="import",
                )
            else:
                continue
            imported += 1
        self._conn.commit()
        return imported

    def import_existing_data(self, settings: Any) -> tuple[int, int]:
        """Bootstrap from data/raw/*.jsonl and data/output/*.csv."""
        jsonl_count = 0
        for path in sorted(settings.raw_dir.glob("*.jsonl")):
            jsonl_count += self.import_from_jsonl(path)

        csv_count = 0
        for path in sorted(settings.output_dir.glob("*.csv")):
            csv_count += self.import_from_csv(path)

        return jsonl_count, csv_count

    def get_playbook(self, profile_key: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT playbook_json, success_count, sample_place_id FROM enrichment_profiles WHERE profile_key = ?",
            (profile_key,),
        ).fetchone()
        if row is None:
            return None
        data = json.loads(row["playbook_json"])
        data["success_count"] = int(row["success_count"])
        data["sample_place_id"] = row["sample_place_id"] or data.get("sample_place_id", "")
        return data

    def record_profile_outcome(
        self,
        profile_key: str,
        *,
        property_type: str,
        site_kind: str,
        brand: str,
        playbook_update: dict[str, Any],
        place_id: str,
        increment_success: bool = True,
    ) -> None:
        """Merge learned playbook fields and bump success count for relational reuse."""
        now = _iso(_utc_now())
        existing = self.get_playbook(profile_key)
        merged: dict[str, Any] = dict(existing or {})
        for key, value in playbook_update.items():
            if value not in (None, "", False) or key in ("trust_google_phone", "skip_firecrawl", "skip_agent"):
                if isinstance(value, bool) or value:
                    merged[key] = value

        success_count = int(merged.get("success_count") or 0)
        if increment_success and (
            playbook_update.get("trust_google_phone")
            or playbook_update.get("skip_agent")
            or playbook_update.get("winning_tier")
        ):
            success_count += 1
        merged["success_count"] = success_count
        merged["sample_place_id"] = place_id

        first_at = now
        if existing:
            row = self._conn.execute(
                "SELECT first_learned_at FROM enrichment_profiles WHERE profile_key = ?",
                (profile_key,),
            ).fetchone()
            if row and row["first_learned_at"]:
                first_at = row["first_learned_at"]

        self._conn.execute(
            """
            INSERT INTO enrichment_profiles (
                profile_key, property_type, site_kind, brand,
                playbook_json, success_count, sample_place_id,
                first_learned_at, last_used_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(profile_key) DO UPDATE SET
                playbook_json = excluded.playbook_json,
                success_count = excluded.success_count,
                sample_place_id = excluded.sample_place_id,
                last_used_at = excluded.last_used_at
            """,
            (
                profile_key,
                property_type,
                site_kind,
                brand,
                json.dumps(merged),
                success_count,
                place_id,
                first_at,
                now,
            ),
        )
        self._conn.commit()

    def count_profiles(self) -> int:
        row = self._conn.execute("SELECT COUNT(*) AS n FROM enrichment_profiles").fetchone()
        return int(row["n"]) if row else 0

    def get_enriched_lead(self, place_id: str) -> EnrichedLead | None:
        row = self._conn.execute(
            "SELECT enriched_json FROM leads WHERE place_id = ? AND enriched_json IS NOT NULL",
            (place_id,),
        ).fetchone()
        if row is None or not row["enriched_json"]:
            return None
        return EnrichedLead.model_validate(json.loads(row["enriched_json"]))

    def list_enriched_leads(
        self,
        *,
        place_ids: set[str] | None = None,
        limit: int | None = None,
    ) -> list[EnrichedLead]:
        query = "SELECT enriched_json FROM leads WHERE enriched_json IS NOT NULL ORDER BY last_enriched_at DESC"
        params: list[Any] = []
        if place_ids:
            placeholders = ",".join("?" for _ in place_ids)
            query = (
                f"SELECT enriched_json FROM leads WHERE place_id IN ({placeholders}) "
                "AND enriched_json IS NOT NULL"
            )
            params = list(place_ids)
        if limit is not None:
            query += " LIMIT ?"
            params.append(limit)
        rows = self._conn.execute(query, params).fetchall()
        leads: list[EnrichedLead] = []
        for row in rows:
            if row["enriched_json"]:
                leads.append(EnrichedLead.model_validate(json.loads(row["enriched_json"])))
        return leads

    def list_profiles(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            """
            SELECT profile_key, property_type, site_kind, brand, success_count,
                   sample_place_id, first_learned_at, last_used_at, playbook_json
            FROM enrichment_profiles
            ORDER BY success_count DESC, last_used_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        result: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            playbook = json.loads(item.pop("playbook_json"))
            item["playbook"] = playbook
            result.append(item)
        return result

    def get_lead_row(self, place_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT * FROM leads WHERE place_id = ?",
            (place_id,),
        ).fetchone()
        return dict(row) if row else None

    def record_run_event(
        self,
        *,
        run_id: str,
        place_id: str,
        stage: str,
        ran: bool,
        reason: str = "",
        credits_est: int = 0,
        duration_ms: int | None = None,
        meta: dict[str, Any] | None = None,
    ) -> None:
        self._conn.execute(
            """
            INSERT INTO run_events (
                run_id, place_id, stage, ran, reason, credits_est, duration_ms, meta_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                place_id,
                stage,
                1 if ran else 0,
                reason,
                credits_est,
                duration_ms,
                json.dumps(meta or {}),
                _iso(_utc_now()),
            ),
        )

    def commit_events(self) -> None:
        self._conn.commit()

    def run_events_for_run(self, run_id: str) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            """
            SELECT stage, place_id, ran, reason, credits_est, duration_ms, created_at
            FROM run_events WHERE run_id = ?
            ORDER BY created_at, id
            """,
            (run_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def run_credits_total(self, run_id: str) -> int:
        row = self._conn.execute(
            "SELECT COALESCE(SUM(credits_est), 0) FROM run_events WHERE run_id = ?",
            (run_id,),
        ).fetchone()
        return int(row[0] if row else 0)

    def run_report(self, run_id: str) -> dict[str, Any]:
        run_row = self._conn.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,)).fetchone()
        if run_row is None:
            return {}
        events = self.run_events_for_run(run_id)
        by_stage: dict[str, dict[str, int]] = {}
        credits_total = 0
        for event in events:
            stage = str(event["stage"])
            bucket = by_stage.setdefault(stage, {"count": 0, "ran": 0, "credits": 0})
            bucket["count"] += 1
            bucket["ran"] += int(event["ran"] or 0)
            credits = int(event["credits_est"] or 0)
            bucket["credits"] += credits
            credits_total += credits
        return {
            "run": dict(run_row),
            "events_count": len(events),
            "credits_est_total": credits_total,
            "by_stage": by_stage,
        }

    def get_domain_cache(self, hostname: str, *, ttl_hours: int = 24) -> bool | None:
        row = self._conn.execute(
            "SELECT is_valid, checked_at FROM domain_cache WHERE hostname = ?",
            (hostname.lower(),),
        ).fetchone()
        if row is None:
            return None
        checked = datetime.fromisoformat(row["checked_at"])
        if _utc_now() - checked > timedelta(hours=ttl_hours):
            return None
        return bool(row["is_valid"])

    def set_domain_cache(self, hostname: str, is_valid: bool) -> None:
        self._conn.execute(
            """
            INSERT INTO domain_cache (hostname, is_valid, checked_at)
            VALUES (?, ?, ?)
            ON CONFLICT(hostname) DO UPDATE SET
                is_valid = excluded.is_valid,
                checked_at = excluded.checked_at
            """,
            (hostname.lower(), 1 if is_valid else 0, _iso(_utc_now())),
        )
        self._conn.commit()

    def upsert_sales_feedback(
        self,
        place_id: str,
        *,
        addressed: bool | None = None,
        feedback_notes: str | None = None,
        sales_ready: bool | None = None,
    ) -> None:
        existing = self._conn.execute(
            "SELECT addressed, feedback_notes, sales_ready FROM sales_feedback WHERE place_id = ?",
            (place_id,),
        ).fetchone()
        now = _iso(_utc_now())
        if existing:
            addr = int(addressed) if addressed is not None else int(existing["addressed"])
            notes = feedback_notes if feedback_notes is not None else (existing["feedback_notes"] or "")
            ready = (
                int(sales_ready)
                if sales_ready is not None
                else (existing["sales_ready"] if existing["sales_ready"] is not None else None)
            )
        else:
            addr = int(addressed or False)
            notes = feedback_notes or ""
            ready = int(sales_ready) if sales_ready is not None else None

        self._conn.execute(
            """
            INSERT INTO sales_feedback (place_id, addressed, feedback_notes, sales_ready, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(place_id) DO UPDATE SET
                addressed = excluded.addressed,
                feedback_notes = excluded.feedback_notes,
                sales_ready = excluded.sales_ready,
                updated_at = excluded.updated_at
            """,
            (place_id, addr, notes, ready, now),
        )
        self._conn.commit()

    def list_sales_feedback(self, limit: int = 100) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            """
            SELECT place_id, addressed, feedback_notes, sales_ready, updated_at
            FROM sales_feedback ORDER BY updated_at DESC LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]

    def count_sales_feedback(self) -> int:
        row = self._conn.execute("SELECT COUNT(*) AS n FROM sales_feedback").fetchone()
        return int(row["n"]) if row else 0

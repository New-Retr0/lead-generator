from __future__ import annotations

import json
import logging
import shutil
import threading
import time
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import psycopg

from pallares_leads.db.local_cache import LocalCache
from pallares_leads.db.pg import PgAdapter, connect, parse_json_field, to_db_timestamp
from pallares_leads.schemas import EnrichedLead, InvestigationStatus, RawLead
from pallares_leads.utils.normalize import normalize_entity_name

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 5

CRM_STATUSES: tuple[str, ...] = (
    "New",
    "Contacted",
    "Follow Up",
    "Interested",
    "Quote Sent",
    "Won",
    "Lost",
    "Bad Data",
)


def normalize_crm_status(value: str | None) -> str | None:
    """Map free-text to a canonical CRM status; None when unrecognized."""
    if not value:
        return None
    cleaned = " ".join(str(value).split()).casefold()
    for status in CRM_STATUSES:
        if cleaned == status.casefold():
            return status
    return None

_COST_EVENT_INSERT_SQL = """
    INSERT INTO cost_events (
        run_id, request_id, place_id, provider, operation,
        units, unit_type, usd, model, meta_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""


def _utc_now() -> datetime:
    return datetime.now(tz=UTC)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


class LeadStore:
    """Postgres ledger for processed leads and run history (Supabase)."""

    def __init__(self, db_url: str | Path | None = None) -> None:
        from pallares_leads.settings import get_settings

        settings = get_settings()
        if isinstance(db_url, Path):
            raise ValueError(
                "SQLite db_path is retired; pass SUPABASE_DB_URL or omit db_url."
            )
        url = str(db_url) if db_url else settings.supabase_db_url
        if not url:
            raise ValueError("SUPABASE_DB_URL is required")
        self.db_url = url
        self._conn: PgAdapter = connect(url)
        self._local_cache = LocalCache(settings.local_cache_path)
        self._lock = threading.RLock()
        self._pending_cost_events: list[tuple[Any, ...]] = []
        self._raw_conn = self._conn._conn  # noqa: SLF001 — for transactions

    @property
    def db_path(self) -> str:
        """Backward compat for callers that passed settings.db_path."""
        return self.db_url

    def close(self) -> None:
        self._conn._conn.close()  # noqa: SLF001
        self._local_cache.close()

    def __enter__(self) -> LeadStore:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    def wal_checkpoint(self, mode: str = "TRUNCATE") -> None:
        del mode  # Postgres has no WAL checkpoint equivalent for clients

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
        if force_refresh or not skip_known:
            return leads, 0
        if not leads:
            return [], 0

        ids = [lead.place_id for lead in leads]
        placeholders = ",".join("?" * len(ids))
        with self._lock:
            rows = self._conn.execute(
                f"SELECT place_id, last_enriched_at FROM leads WHERE place_id IN ({placeholders})",
                ids,
            ).fetchall()
        known = {str(row["place_id"]): row["last_enriched_at"] for row in rows}

        kept: list[RawLead] = []
        skipped = 0
        cutoff = (
            _utc_now() - timedelta(days=refresh_after_days)
            if refresh_after_days is not None
            else None
        )
        for lead in leads:
            last = known.get(lead.place_id)
            if not last:
                kept.append(lead)
                continue
            if refresh_after_days is None:
                skipped += 1
                continue
            last_enriched = datetime.fromisoformat(last)
            if cutoff is not None and last_enriched < cutoff:
                kept.append(lead)
            else:
                skipped += 1
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
        with self._lock:
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
            self._conn.commit()

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
        lead_score: int | None = None,
        request_id: str | None = None,
    ) -> None:
        now = _iso(_utc_now())
        enriched_json = lead.model_dump(mode="json")
        score = lead_score if lead_score is not None else lead.lead_score
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO leads (
                    place_id, business_name, market_key, category_key, city,
                    first_seen_at, last_seen_at, last_enriched_at, last_run_id,
                    enrichment_status, confidence, source_tool, csv_path, profile_key,
                    enriched_json, credits_total, lead_score, request_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    credits_total = COALESCE(excluded.credits_total, leads.credits_total),
                    lead_score = COALESCE(excluded.lead_score, leads.lead_score),
                    request_id = COALESCE(excluded.request_id, leads.request_id)
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
                    enriched_json,
                    credits_total,
                    score,
                    request_id,
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
        with self._lock:
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
        with self._lock:
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
            "SELECT playbook_json, success_count, sample_place_id "
            "FROM enrichment_profiles WHERE profile_key = ?",
            (profile_key,),
        ).fetchone()
        if row is None:
            return None
        data = parse_json_field(row["playbook_json"])
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
            if value not in (None, "", False) or key in ("trust_google_phone", "skip_firecrawl"):
                if isinstance(value, bool) or value:
                    merged[key] = value

        success_count = int(merged.get("success_count") or 0)
        if increment_success and (
            playbook_update.get("trust_google_phone") or playbook_update.get("winning_tier")
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

        with self._lock:
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
                    merged,
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
        return EnrichedLead.model_validate(parse_json_field(row["enriched_json"]))

    def list_enriched_leads(
        self,
        *,
        place_ids: set[str] | None = None,
        limit: int | None = None,
    ) -> list[EnrichedLead]:
        query = (
            "SELECT enriched_json FROM leads "
            "WHERE enriched_json IS NOT NULL ORDER BY last_enriched_at DESC"
        )
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
                leads.append(EnrichedLead.model_validate(parse_json_field(row["enriched_json"])))
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
            playbook = parse_json_field(item.pop("playbook_json"))
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
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO run_events (
                    run_id, place_id, stage, ran, reason, credits_est,
                    duration_ms, meta_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    place_id,
                    stage,
                    ran,
                    reason,
                    credits_est,
                    duration_ms,
                    meta or {},
                    _iso(_utc_now()),
                ),
            )

    def commit_events(self) -> None:
        with self._lock:
            self._conn.commit()

    def record_fact(
        self,
        *,
        place_id: str,
        fact_kind: str,
        value: dict[str, Any],
        source_kind: str,
        method: str,
        verification: str,
        source_url: str | None = None,
        quote: str | None = None,
        run_id: str | None = None,
    ) -> None:
        """Append one provenance fact for a lead (phone, person, email, social, …)."""
        with self._lock:
            self._conn.execute(
                """
            INSERT INTO lead_facts (
                place_id, fact_kind, value_json, source_kind, source_url,
                method, quote, verification, run_id, observed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                place_id,
                fact_kind,
                value,
                source_kind,
                source_url,
                method,
                quote,
                verification,
                run_id,
                _iso(_utc_now()),
            ),
        )

    def facts_for_lead(self, place_id: str) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            """
            SELECT id, fact_kind, value_json, source_kind, source_url,
                   method, quote, verification, run_id, observed_at
            FROM lead_facts WHERE place_id = ?
            ORDER BY observed_at, id
            """,
            (place_id,),
        ).fetchall()
        facts: list[dict[str, Any]] = []
        for row in rows:
            fact = dict(row)
            try:
                fact["value"] = parse_json_field(fact.pop("value_json"))
            except (TypeError, json.JSONDecodeError):
                fact["value"] = {}
            facts.append(fact)
        return facts

    def delete_facts_for_lead(self, place_id: str) -> None:
        """Clear prior facts before a fresh enrichment writes the new ledger."""
        with self._lock:
            self._conn.execute("DELETE FROM lead_facts WHERE place_id = ?", (place_id,))

    def commit_facts(self) -> None:
        with self._lock:
            self._conn.commit()

    def repair_stuck_runs(self, *, older_than_hours: int = 24) -> int:
        """Mark long-running runs as failed (dashboard cleanup)."""
        cutoff = _iso(_utc_now() - timedelta(hours=older_than_hours))
        with self._lock:
            cur = self._conn.execute(
                """
                UPDATE runs SET status = 'failed', finished_at = ?
                WHERE status = 'running' AND started_at < ?
                """,
                (_iso(_utc_now()), cutoff),
            )
            self._conn.commit()
            return cur.rowcount

    def related_leads(self, place_id: str, *, limit: int = 10) -> list[dict[str, Any]]:
        """Leads sharing owner entity, management domain, or website domain."""
        row = self._conn.execute(
            "SELECT enriched_json, profile_key FROM leads WHERE place_id = ?",
            (place_id,),
        ).fetchone()
        if row is None:
            return []

        enriched: dict[str, Any] = {}
        if row["enriched_json"]:
            try:
                enriched = parse_json_field(row["enriched_json"])
            except json.JSONDecodeError:
                enriched = {}

        from pallares_leads.enrich.lead_profile import registrable_domain

        website = enriched.get("website") or ""
        domain = registrable_domain(str(website)) if website else ""
        profile_key = row["profile_key"] or enriched.get("profile_key") or ""

        owner_row = self._conn.execute(
            "SELECT owner_name_normalized FROM owner_records WHERE place_id = ?",
            (place_id,),
        ).fetchone()
        owner_norm = owner_row["owner_name_normalized"] if owner_row else ""

        related: list[dict[str, Any]] = []
        seen: set[str] = {place_id}

        if owner_norm:
            rows = self._conn.execute(
                """
                SELECT l.place_id, l.business_name, l.city, o.owner_name
                FROM owner_records o
                JOIN leads l ON l.place_id = o.place_id
                WHERE o.owner_name_normalized = ? AND o.place_id != ?
                LIMIT ?
                """,
                (owner_norm, place_id, limit),
            ).fetchall()
            for r in rows:
                pid = str(r["place_id"])
                if pid in seen:
                    continue
                seen.add(pid)
                related.append(
                    {
                        "place_id": pid,
                        "business_name": r["business_name"],
                        "city": r["city"],
                        "relation": "same_owner",
                        "detail": r["owner_name"],
                    }
                )

        if profile_key.startswith("mgmt:") and len(related) < limit:
            rows = self._conn.execute(
                """
                SELECT place_id, business_name, city, profile_key
                FROM leads
                WHERE profile_key = ? AND place_id != ?
                LIMIT ?
                """,
                (profile_key, place_id, limit - len(related)),
            ).fetchall()
            for r in rows:
                pid = str(r["place_id"])
                if pid in seen:
                    continue
                seen.add(pid)
                related.append(
                    {
                        "place_id": pid,
                        "business_name": r["business_name"],
                        "city": r["city"],
                        "relation": "same_manager",
                        "detail": profile_key,
                    }
                )

        if domain and len(related) < limit:
            rows = self._conn.execute(
                """
                SELECT place_id, business_name, city, enriched_json
                FROM leads
                WHERE place_id != ? AND enriched_json::text LIKE ?
                LIMIT ?
                """,
                (place_id, f"%{domain}%", limit - len(related)),
            ).fetchall()
            for r in rows:
                pid = str(r["place_id"])
                if pid in seen:
                    continue
                seen.add(pid)
                related.append(
                    {
                        "place_id": pid,
                        "business_name": r["business_name"],
                        "city": r["city"],
                        "relation": "same_domain",
                        "detail": domain,
                    }
                )

        return related[:limit]

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
        with self._lock:
            row = self._conn.execute(
                """
                SELECT COALESCE(SUM(units), 0) FROM cost_events
                WHERE run_id = ? AND provider = 'firecrawl'
                """,
                (run_id,),
            ).fetchone()
        return int(row[0] if row else 0)

    def total_firecrawl_credits(self) -> int:
        row = self._conn.execute(
            "SELECT COALESCE(SUM(units), 0) AS n FROM cost_events WHERE provider = 'firecrawl'"
        ).fetchone()
        return int(row["n"]) if row else 0

    def lead_run_credits(self, run_id: str, place_id: str) -> int:
        row = self._conn.execute(
            """
            SELECT COALESCE(SUM(units), 0) FROM cost_events
            WHERE run_id = ? AND place_id = ? AND provider = 'firecrawl'
            """,
            (run_id, place_id),
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
        cost = self.cost_summary(run_id)
        return {
            "run": dict(run_row),
            "events_count": len(events),
            "credits_est_total": credits_total,
            "by_stage": by_stage,
            "cost_summary": cost,
        }

    def get_domain_cache(self, hostname: str, *, ttl_hours: int = 24) -> bool | None:
        return self._local_cache.get_domain_cache(hostname, ttl_hours=ttl_hours)

    def set_domain_cache(self, hostname: str, is_valid: bool) -> None:
        self._local_cache.set_domain_cache(hostname, is_valid)

    def upsert_sales_feedback(
        self,
        place_id: str,
        *,
        addressed: bool | None = None,
        feedback_notes: str | None = None,
        sales_ready: bool | None = None,
        status: str | None = None,
        assigned_to: str | None = None,
    ) -> None:
        existing = self._conn.execute(
            "SELECT addressed, feedback_notes, sales_ready, status, assigned_to "
            "FROM sales_feedback WHERE place_id = ?",
            (place_id,),
        ).fetchone()
        now = _iso(_utc_now())
        normalized = normalize_crm_status(status)
        if existing:
            addr = addressed if addressed is not None else bool(existing["addressed"])
            notes = (
                feedback_notes if feedback_notes is not None else (existing["feedback_notes"] or "")
            )
            ready = (
                sales_ready
                if sales_ready is not None
                else (existing["sales_ready"] if existing["sales_ready"] is not None else None)
            )
            new_status = normalized or existing["status"] or "New"
            assignee = assigned_to if assigned_to is not None else existing["assigned_to"]
        else:
            addr = bool(addressed or False)
            notes = feedback_notes or ""
            ready = sales_ready
            new_status = normalized or "New"
            assignee = assigned_to

        with self._lock:
            self._conn.execute(
                """
            INSERT INTO sales_feedback (
                place_id, addressed, feedback_notes, sales_ready, status, assigned_to, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(place_id) DO UPDATE SET
                addressed = excluded.addressed,
                feedback_notes = excluded.feedback_notes,
                sales_ready = excluded.sales_ready,
                status = excluded.status,
                assigned_to = excluded.assigned_to,
                updated_at = excluded.updated_at
            """,
                (place_id, addr, notes, ready, new_status, assignee, now),
            )
            self._conn.commit()

    def get_crm_statuses(self, place_ids: list[str] | None = None) -> dict[str, str]:
        """place_id -> CRM status. All rows when place_ids is None."""
        if place_ids:
            marks = ",".join("?" for _ in place_ids)
            rows = self._conn.execute(
                f"SELECT place_id, status FROM sales_feedback WHERE place_id IN ({marks})",
                place_ids,
            ).fetchall()
        else:
            rows = self._conn.execute("SELECT place_id, status FROM sales_feedback").fetchall()
        return {str(r["place_id"]): str(r["status"] or "New") for r in rows}

    def list_sales_feedback(self, limit: int = 100) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            """
            SELECT place_id, addressed, feedback_notes, sales_ready, status, assigned_to, updated_at
            FROM sales_feedback ORDER BY updated_at DESC LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]

    def count_sales_feedback(self) -> int:
        row = self._conn.execute("SELECT COUNT(*) AS n FROM sales_feedback").fetchone()
        return int(row["n"]) if row else 0

    def get_app_state(self, key: str) -> str | None:
        row = self._conn.execute(
            "SELECT value FROM app_state WHERE key = ?",
            (key,),
        ).fetchone()
        return str(row["value"]) if row else None

    def set_app_state(self, key: str, value: str) -> None:
        now = _iso(_utc_now())
        with self._lock:
            self._conn.execute(
                """
            INSERT INTO app_state (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
            """,
                (key, value, now),
            )
            self._conn.commit()

    def upsert_owner_record(
        self,
        *,
        place_id: str,
        owner_name: str,
        apn: str = "",
        owner_kind: str = "",
        sos_entity_number: str = "",
        registered_agent: str = "",
        principals_json: list[dict[str, Any]] | None = None,
        mailing_address: str = "",
        broker_json: list[dict[str, Any]] | None = None,
        source: str = "",
    ) -> None:
        now = _iso(_utc_now())
        normalized = normalize_entity_name(owner_name)
        with self._lock:
            self._conn.execute(
                """
            INSERT INTO owner_records (
                place_id, apn, owner_name, owner_name_normalized, owner_kind,
                sos_entity_number, registered_agent, principals_json, mailing_address,
                broker_json, source, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(place_id) DO UPDATE SET
                apn = excluded.apn,
                owner_name = excluded.owner_name,
                owner_name_normalized = excluded.owner_name_normalized,
                owner_kind = excluded.owner_kind,
                sos_entity_number = excluded.sos_entity_number,
                registered_agent = excluded.registered_agent,
                principals_json = excluded.principals_json,
                mailing_address = excluded.mailing_address,
                broker_json = excluded.broker_json,
                source = excluded.source,
                updated_at = excluded.updated_at
            """,
            (
                place_id,
                apn,
                owner_name,
                normalized,
                owner_kind,
                sos_entity_number,
                registered_agent,
                principals_json or [],
                mailing_address,
                broker_json or [],
                source,
                now,
                now,
            ),
            )
            self._conn.commit()

    def get_owner_record(self, place_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT * FROM owner_records WHERE place_id = ?",
            (place_id,),
        ).fetchone()
        if row is None:
            return None
        data = dict(row)
        data["principals_json"] = parse_json_field(data.get("principals_json")) or []
        data["broker_json"] = parse_json_field(data.get("broker_json")) or []
        return data

    def get_owner_record_by_name(self, owner_name: str) -> dict[str, Any] | None:
        normalized = normalize_entity_name(owner_name)
        row = self._conn.execute(
            """
            SELECT * FROM owner_records
            WHERE owner_name_normalized = ?
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            (normalized,),
        ).fetchone()
        if row is None:
            return None
        data = dict(row)
        data["principals_json"] = parse_json_field(data.get("principals_json")) or []
        data["broker_json"] = parse_json_field(data.get("broker_json")) or []
        return data

    def run_stage_count(self, run_id: str, stage: str) -> int:
        with self._lock:
            row = self._conn.execute(
                """
                SELECT COUNT(*) AS n FROM run_events
                WHERE run_id = ? AND stage = ? AND ran = true
                """,
                (run_id, stage),
            ).fetchone()
        return int(row["n"]) if row else 0

    def try_reserve_run_stage(self, run_id: str, stage: str, max_count: int) -> bool:
        """Atomically reserve one slot against a per-run stage cap."""
        if max_count <= 0:
            return False
        key = f"run_cap:{run_id}:{stage}"
        with self._lock:
            try:
                self._raw_conn.execute("BEGIN")
                row = self._conn.execute(
                    "SELECT value FROM app_state WHERE key = ? FOR UPDATE",
                    (key,),
                ).fetchone()
                current = int(row["value"]) if row and str(row["value"]).isdigit() else 0
                if current >= max_count:
                    self._raw_conn.rollback()
                    return False
                now = _iso(_utc_now())
                self._conn.execute(
                    """
                    INSERT INTO app_state (key, value, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET
                        value = CAST(CAST(app_state.value AS INTEGER) + 1 AS TEXT),
                        updated_at = excluded.updated_at
                    """,
                    (key, str(current + 1), now),
                )
                self._conn.commit()
                return True
            except Exception:
                self._raw_conn.rollback()
                raise

    def update_lead_csv_path(self, place_id: str, csv_path: str) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE leads SET csv_path = ? WHERE place_id = ?",
                (csv_path, place_id),
            )
            self._conn.commit()

    def record_cost_event(
        self,
        *,
        provider: str,
        operation: str,
        units: float = 0,
        unit_type: str = "credits",
        usd: float | None = None,
        run_id: str | None = None,
        request_id: str | None = None,
        place_id: str | None = None,
        model: str | None = None,
        meta: dict[str, Any] | None = None,
    ) -> None:
        params = (
            run_id,
            request_id,
            place_id,
            provider,
            operation,
            units,
            unit_type,
            usd,
            model,
            meta or {},
            _iso(_utc_now()),
        )
        max_attempts = 8
        for attempt in range(1, max_attempts + 1):
            try:
                with self._lock:
                    self._conn.execute(_COST_EVENT_INSERT_SQL, params)
                return
            except psycopg.OperationalError as exc:
                if attempt == max_attempts:
                    logger.warning("Queueing cost event after lock contention: %s", exc)
                    with self._lock:
                        self._pending_cost_events.append(params)
                    return
                time.sleep(min(0.25 * (2 ** (attempt - 1)), 8.0))

    def _flush_pending_cost_events(self) -> None:
        while True:
            with self._lock:
                if not self._pending_cost_events:
                    return
                params = self._pending_cost_events[0]
            inserted = False
            for attempt in range(1, 9):
                try:
                    with self._lock:
                        self._conn.execute(_COST_EVENT_INSERT_SQL, params)
                        self._pending_cost_events.pop(0)
                        self._conn.commit()
                    inserted = True
                    break
                except psycopg.OperationalError:
                    time.sleep(min(0.25 * (2 ** (attempt - 1)), 8.0))
            if not inserted:
                logger.error("Failed to flush queued cost event after retries")
                return

    def commit_cost_events(self) -> None:
        with self._lock:
            self._conn.commit()
        self._flush_pending_cost_events()

    def cost_summary(
        self,
        run_id: str | None = None,
        *,
        request_id: str | None = None,
    ) -> dict[str, Any]:
        clauses: list[str] = []
        params: list[Any] = []
        if run_id:
            clauses.append("run_id = ?")
            params.append(run_id)
        if request_id:
            clauses.append("request_id = ?")
            params.append(request_id)

        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = self._conn.execute(
            f"""
            SELECT provider, operation, unit_type,
                   COALESCE(SUM(units), 0) AS units_total,
                   COALESCE(SUM(usd), 0) AS usd_total,
                   COUNT(*) AS event_count
            FROM cost_events
            {where}
            GROUP BY provider, operation, unit_type
            ORDER BY provider, operation
            """,
            params,
        ).fetchall()

        totals = self._conn.execute(
            f"""
            SELECT COALESCE(SUM(units), 0) AS units_total,
                   COALESCE(SUM(usd), 0) AS usd_total,
                   COUNT(*) AS event_count
            FROM cost_events
            {where}
            """,
            params,
        ).fetchone()

        by_provider: dict[str, dict[str, Any]] = {}
        for row in rows:
            provider = str(row["provider"])
            bucket = by_provider.setdefault(
                provider,
                {"usd_total": 0.0, "units_total": 0.0, "event_count": 0, "operations": []},
            )
            usd_total = float(row["usd_total"] or 0)
            units_total = float(row["units_total"] or 0)
            event_count = int(row["event_count"] or 0)
            bucket["usd_total"] += usd_total
            bucket["units_total"] += units_total
            bucket["event_count"] += event_count
            bucket["operations"].append(
                {
                    "operation": row["operation"],
                    "unit_type": row["unit_type"],
                    "units_total": units_total,
                    "usd_total": usd_total,
                    "event_count": event_count,
                }
            )

        return {
            "run_id": run_id,
            "request_id": request_id,
            "event_count": int(totals["event_count"] if totals else 0),
            "units_total": float(totals["units_total"] if totals else 0),
            "usd_total": float(totals["usd_total"] if totals else 0),
            "by_provider": by_provider,
        }

    @staticmethod
    def _page_cache_key(url: str, content_type: str) -> str:
        return LocalCache.page_cache_key(url, content_type)

    def get_page_cache(
        self,
        url: str,
        *,
        content_type: str = "markdown",
        ttl_days: int | None = None,
    ) -> dict[str, Any] | None:
        return self._local_cache.get_page_cache(
            url, content_type=content_type, ttl_days=ttl_days
        )

    def set_page_cache(
        self,
        url: str,
        *,
        content_type: str,
        content: str,
        credits_used: int = 0,
    ) -> None:
        self._local_cache.set_page_cache(
            url,
            content_type=content_type,
            content=content,
            credits_used=credits_used,
        )

    def prune_stale_data(
        self,
        *,
        runs_dir: Path,
        page_cache_ttl_days: int,
        keep_days: int,
        dry_run: bool = False,
    ) -> dict[str, int]:
        """Drop expired page_cache rows and old run artifact folders safe to delete."""
        stats = {
            "page_cache_deleted": 0,
            "run_dirs_deleted": 0,
            "run_dirs_skipped": 0,
            "run_events_deleted": 0,
            "cost_events_deleted": 0,
        }
        cache_cutoff = _iso(_utc_now() - timedelta(days=page_cache_ttl_days))
        stats["page_cache_deleted"] = self._local_cache.prune_page_cache(
            ttl_days=page_cache_ttl_days, dry_run=dry_run
        )

        events_cutoff = _iso(_utc_now() - timedelta(days=keep_days))
        if dry_run:
            row = self._conn.execute(
                "SELECT COUNT(*) AS n FROM run_events WHERE created_at < ?",
                (events_cutoff,),
            ).fetchone()
            stats["run_events_deleted"] = int(row["n"]) if row else 0
            row = self._conn.execute(
                "SELECT COUNT(*) AS n FROM cost_events WHERE created_at < ?",
                (events_cutoff,),
            ).fetchone()
            stats["cost_events_deleted"] = int(row["n"]) if row else 0
        else:
            cur = self._conn.execute(
                "DELETE FROM run_events WHERE created_at < ?",
                (events_cutoff,),
            )
            stats["run_events_deleted"] = cur.rowcount
            cur = self._conn.execute(
                "DELETE FROM cost_events WHERE created_at < ?",
                (events_cutoff,),
            )
            stats["cost_events_deleted"] = cur.rowcount
            self._conn.commit()

        if not runs_dir.is_dir():
            return stats

        run_cutoff = _utc_now() - timedelta(days=keep_days)
        for run_dir in sorted(runs_dir.iterdir()):
            if not run_dir.is_dir():
                continue
            try:
                mtime = datetime.fromtimestamp(run_dir.stat().st_mtime, tz=UTC)
            except OSError:
                stats["run_dirs_skipped"] += 1
                continue
            if mtime >= run_cutoff:
                continue

            place_ids: set[str] = set()
            for jsonl_path in run_dir.glob("raw_*.jsonl"):
                try:
                    with jsonl_path.open(encoding="utf-8") as handle:
                        for line in handle:
                            line = line.strip()
                            if not line:
                                continue
                            payload = json.loads(line)
                            pid = payload.get("place_id")
                            if isinstance(pid, str) and pid:
                                place_ids.add(pid)
                except (OSError, json.JSONDecodeError):
                    continue

            if place_ids:
                missing = [pid for pid in place_ids if self.get_lead_row(pid) is None]
                if missing:
                    stats["run_dirs_skipped"] += 1
                    continue

            if dry_run:
                stats["run_dirs_deleted"] += 1
            else:
                shutil.rmtree(run_dir, ignore_errors=True)
                stats["run_dirs_deleted"] += 1

        return stats

    def record_credit_snapshot(
        self,
        *,
        provider: str,
        remaining_credits: float | None = None,
        used_credits: float | None = None,
        snapshot: dict[str, Any] | None = None,
    ) -> None:
        with self._lock:
            self._conn.execute(
                """
            INSERT INTO credit_snapshots (
                provider, remaining_credits, used_credits, snapshot_json, created_at
            ) VALUES (?, ?, ?, ?, ?)
            """,
                (
                    provider,
                    remaining_credits,
                    used_credits,
                    snapshot or {},
                    _iso(_utc_now()),
                ),
            )
            self._conn.commit()

    def create_lead_request(
        self,
        request_id: str,
        *,
        raw_prompt: str,
        spec: Any,
    ) -> None:
        spec_json = (
            spec.model_dump(mode="json") if hasattr(spec, "model_dump") else spec
        )
        self._conn.execute(
            """
            INSERT INTO lead_requests (
                request_id, created_at, raw_prompt, spec_json, status
            ) VALUES (?, ?, ?, ?, 'running')
            """,
            (request_id, _iso(_utc_now()), raw_prompt, spec_json),
        )
        self._conn.commit()

    def finish_lead_request(
        self,
        request_id: str,
        *,
        status: str,
        leads_delivered: int,
        credits_spent: int,
        output_path: str | None = None,
        usd_spent: float | None = None,
    ) -> None:
        self._conn.execute(
            """
            UPDATE lead_requests SET
                status = ?,
                leads_delivered = ?,
                credits_spent = ?,
                usd_spent = ?,
                output_path = ?
            WHERE request_id = ?
            """,
            (status, leads_delivered, credits_spent, usd_spent, output_path, request_id),
        )
        self._conn.commit()

    def link_request_lead(
        self,
        request_id: str,
        place_id: str,
        score: int,
        rank: int,
    ) -> None:
        self._conn.execute(
            """
            INSERT INTO request_leads (request_id, place_id, rank, score)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(request_id, place_id) DO UPDATE SET
                rank = excluded.rank,
                score = excluded.score
            """,
            (request_id, place_id, rank, score),
        )
        self._conn.execute(
            "UPDATE leads SET request_id = ? WHERE place_id = ?",
            (request_id, place_id),
        )
        self._conn.commit()

    def get_lead_request(self, request_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT * FROM lead_requests WHERE request_id = ?",
            (request_id,),
        ).fetchone()
        if row is None:
            return None
        data = dict(row)
        data["spec"] = parse_json_field(data.pop("spec_json"))
        rows = self._conn.execute(
            """
            SELECT place_id, rank, score FROM request_leads
            WHERE request_id = ? ORDER BY rank
            """,
            (request_id,),
        ).fetchall()
        data["leads"] = [dict(r) for r in rows]
        return data

    def query_leads_for_request(
        self,
        *,
        categories: list[str],
        market_keys: list[str],
        min_lead_score: int,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        if not categories or not market_keys:
            return []
        cat_placeholders = ",".join("?" for _ in categories)
        market_placeholders = ",".join("?" for _ in market_keys)
        query = f"""
            SELECT place_id, market_key, category_key, lead_score, confidence
            FROM leads
            WHERE enriched_json IS NOT NULL
              AND category_key IN ({cat_placeholders})
              AND market_key IN ({market_placeholders})
              AND (lead_score IS NULL OR lead_score >= ?)
            ORDER BY COALESCE(lead_score, 0) DESC, last_enriched_at DESC
            LIMIT ?
        """
        params: list[Any] = [*categories, *market_keys, min_lead_score, limit]
        rows = self._conn.execute(query, params).fetchall()
        return [dict(row) for row in rows]

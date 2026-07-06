from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Json

from pallares_leads.settings import get_settings

QUEUE_NAME = "pipeline_jobs"

ALLOWED_ENV_OVERRIDES = frozenset({
    "ENRICHMENT_PARALLEL_WORKERS",
    "FIRECRAWL_MAX_CONCURRENCY",
    "FIRECRAWL_MAX_CREDITS_PER_RUN",
    "FIRECRAWL_SESSION_CREDIT_STOP",
    "BROWSER_USE_ENABLED",
    "OWNER_CHAIN_BACKEND",
    "AI_GATEWAY_ENABLED",
    "AI_OWNER_DISAMBIGUATION",
    "AI_NEED_SIGNAL_FALLBACK",
})


def apply_env_overrides(env: dict[str, str], payload: dict[str, Any]) -> dict[str, str]:
    """Apply allowlisted per-run env overrides from a job payload."""
    for key, value in (payload.get("env_overrides") or {}).items():
        if key in ALLOWED_ENV_OVERRIDES:
            env[key] = str(value)
    return env


def now_utc() -> datetime:
    return datetime.now(UTC)


@dataclass
class QueueMessage:
    msg_id: int
    read_ct: int
    message: dict[str, Any]


def _json_obj(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _truthy(value: Any) -> bool:
    return value is True or (isinstance(value, str) and value.lower() in {"1", "true", "yes"})


def _try_parse_progress_event(line: str) -> dict[str, Any] | None:
    trimmed = line.strip()
    if not trimmed.startswith("{"):
        return None
    try:
        parsed = json.loads(trimmed)
    except json.JSONDecodeError:
        return None
    if parsed.get("t") != "evt" or not isinstance(parsed.get("event"), str):
        return None
    return parsed


def build_cli_args(kind: str, payload: dict[str, Any]) -> list[str]:
    args: list[str]
    if kind == "doctor":
        return ["doctor"]
    if kind == "run":
        market = str(payload.get("market") or "").strip()
        category = str(payload.get("category") or "").strip()
        if not market or not category:
            raise ValueError("run jobs require market and category")
        args = ["run", "--market", market, "--category", category]
    elif kind == "run_campaign":
        campaign = str(payload.get("campaign") or "central_valley").strip()
        args = ["run-campaign", "--campaign", campaign]
        if payload.get("market"):
            args.extend(["--market", str(payload["market"])])
        if payload.get("category"):
            args.extend(["--category", str(payload["category"])])
    elif kind == "request":
        prompt = str(payload.get("prompt") or "").strip()
        if not prompt and not payload.get("spec_json"):
            raise ValueError("request jobs require prompt or spec_json")
        args = ["request"]
        if prompt:
            args.append(prompt)
        if payload.get("spec_json"):
            spec_json = payload["spec_json"]
            args.extend([
                "--spec-json",
                spec_json if isinstance(spec_json, str) else json.dumps(spec_json),
            ])
        if _truthy(payload.get("yes", True)):
            args.append("--yes")
    else:
        raise ValueError(f"unsupported job kind: {kind}")

    if payload.get("limit") not in (None, ""):
        args.extend(["--limit", str(int(payload["limit"]))])
    if _truthy(payload.get("discover_only")):
        args.append("--discover-only")
    if _truthy(payload.get("dry_run")):
        args.append("--dry-run")
    if _truthy(payload.get("no_sheets", True)) and kind in {"run", "run_campaign"}:
        args.append("--no-sheets")
    if _truthy(payload.get("no_skip_known")) and kind in {"run", "run_campaign"}:
        args.append("--no-skip-known")
    if payload.get("refresh_after_days") not in (None, "") and kind in {"run", "run_campaign"}:
        args.extend(["--refresh-after-days", str(int(payload["refresh_after_days"]))])
    return args


class PipelineQueueWorker:
    def __init__(
        self,
        db_url: str,
        *,
        visibility_timeout_s: int = 3600,
        worker_id: str | None = None,
    ) -> None:
        self.db_url = db_url
        self.visibility_timeout_s = visibility_timeout_s
        self.project_root = get_settings().project_root
        self.worker_id = worker_id or os.environ.get(
            "PALLARES_WORKER_ID",
            f"{socket.gethostname()}-{uuid.uuid4().hex[:8]}",
        )

    def connect(self) -> psycopg.Connection:
        return psycopg.connect(
            self.db_url,
            row_factory=dict_row,
            autocommit=True,
            prepare_threshold=None,
        )

    def heartbeat(
        self,
        conn: psycopg.Connection,
        *,
        status: str,
        current_job_id: str | None = None,
    ) -> None:
        conn.execute(
            """
            insert into public.worker_status (
              worker_id, hostname, last_seen, current_job_id, status
            )
            values (%s, %s, now(), %s, %s)
            on conflict (worker_id) do update set
              hostname = excluded.hostname,
              last_seen = excluded.last_seen,
              current_job_id = excluded.current_job_id,
              status = excluded.status
            """,
            (self.worker_id, socket.gethostname(), current_job_id, status),
        )

    def read_one(self, conn: psycopg.Connection) -> QueueMessage | None:
        row = conn.execute(
            "select * from pgmq.read(%s, %s, 1)",
            (QUEUE_NAME, self.visibility_timeout_s),
        ).fetchone()
        if row is None:
            return None
        return QueueMessage(
            msg_id=int(row["msg_id"]),
            read_ct=int(row["read_ct"]),
            message=_json_obj(row["message"]),
        )

    def archive(self, conn: psycopg.Connection, msg_id: int) -> None:
        conn.execute("select pgmq.archive(%s, %s)", (QUEUE_NAME, msg_id))

    def update_job(self, conn: psycopg.Connection, job_id: str, **fields: Any) -> None:
        if not fields:
            return
        assignments = []
        values: list[Any] = []
        for key, value in fields.items():
            assignments.append(f"{key} = %s")
            if isinstance(value, (dict, list)):
                values.append(Json(value))
            else:
                values.append(value)
        assignments.append("updated_at = now()")
        values.append(job_id)
        conn.execute(
            f"update public.pipeline_jobs set {', '.join(assignments)} where id = %s",
            values,
        )

    def job_row(self, conn: psycopg.Connection, job_id: str) -> dict[str, Any] | None:
        return conn.execute(
            """
            select id, kind, payload, attempts, max_attempts, status
            from public.pipeline_jobs
            where id = %s
            """,
            (job_id,),
        ).fetchone()

    def run_job(self, conn: psycopg.Connection, msg: QueueMessage) -> None:
        job_id = str(msg.message.get("job_id") or "")
        if not job_id:
            self.archive(conn, msg.msg_id)
            return

        row = self.job_row(conn, job_id)
        if not row:
            self.archive(conn, msg.msg_id)
            return
        if row["status"] == "cancelled":
            self.archive(conn, msg.msg_id)
            return

        payload = _json_obj(row["payload"])
        kind = str(row["kind"])
        attempts = int(row["attempts"] or 0) + 1
        max_attempts = int(row["max_attempts"] or 3)

        try:
            cli_args = build_cli_args(kind, payload)
        except Exception as exc:
            self.update_job(
                conn,
                job_id,
                status="failed",
                attempts=attempts,
                error=str(exc),
                finished_at=now_utc(),
            )
            self.archive(conn, msg.msg_id)
            return

        command = [sys.executable, "-m", "pallares_leads.cli", *cli_args]
        command_text = " ".join(command)
        self.update_job(
            conn,
            job_id,
            status="running",
            attempts=attempts,
            command=command_text,
            started_at=now_utc(),
            error=None,
        )
        self.heartbeat(conn, status="busy", current_job_id=job_id)

        env = os.environ.copy()
        env.setdefault("PALLARES_LOG_JSON", "1")
        apply_env_overrides(env, payload)
        proc = subprocess.Popen(
            command,
            cwd=self.project_root,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        logs: list[str] = []
        linked_run_id: str | None = None
        assert proc.stdout is not None
        for line in proc.stdout:
            text = line.rstrip()
            if text:
                print(text, flush=True)
                logs.append(text)
                if len(logs) > 10000:
                    logs = logs[-10000:]
                evt = _try_parse_progress_event(text)
                if evt and not linked_run_id:
                    run_id = evt.get("run_id")
                    if isinstance(run_id, str) and run_id.strip():
                        linked_run_id = run_id.strip()
                        self.update_job(conn, job_id, run_id=linked_run_id)
                self.update_job(conn, job_id, logs=logs)
                self.heartbeat(conn, status="busy", current_job_id=job_id)
        code = proc.wait()

        if code == 0:
            self.update_job(
                conn,
                job_id,
                status="succeeded",
                logs=logs,
                result_json={"exit_code": code},
                finished_at=now_utc(),
            )
            self.archive(conn, msg.msg_id)
            return

        if attempts >= max_attempts:
            self.update_job(
                conn,
                job_id,
                status="failed",
                logs=logs,
                error=f"CLI exited {code}",
                result_json={"exit_code": code},
                finished_at=now_utc(),
            )
            self.archive(conn, msg.msg_id)
        else:
            self.update_job(
                conn,
                job_id,
                status="queued",
                logs=logs,
                error=f"CLI exited {code}; waiting for retry",
                result_json={"exit_code": code},
                finished_at=now_utc(),
            )

    def run_loop(self, *, once: bool = False, idle_sleep_s: float = 5.0) -> int:
        with self.connect() as conn:
            self.heartbeat(conn, status="idle")
            while True:
                self.heartbeat(conn, status="idle")
                msg = self.read_one(conn)
                if msg is None:
                    if once:
                        return 0
                    time.sleep(idle_sleep_s)
                    continue
                self.run_job(conn, msg)
                if once:
                    return 0


def main(args: argparse.Namespace) -> int:
    settings = get_settings()
    if not settings.supabase_db_url:
        print("SUPABASE_DB_URL is required for the queue worker", file=sys.stderr)
        return 1
    worker = PipelineQueueWorker(
        settings.supabase_db_url,
        visibility_timeout_s=args.visibility_timeout,
    )
    return worker.run_loop(once=args.once, idle_sleep_s=args.idle_sleep)


def add_worker_parser(subparsers: argparse._SubParsersAction) -> None:
    parser = subparsers.add_parser("worker", help="Consume Supabase queued pipeline jobs")
    parser.add_argument("--once", action="store_true", help="Process at most one queue message")
    parser.add_argument("--idle-sleep", type=float, default=5.0)
    parser.add_argument("--visibility-timeout", type=int, default=3600)
    parser.set_defaults(func=main)

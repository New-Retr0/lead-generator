import { NextResponse } from "next/server";
import { dbAvailable, getSql } from "@/lib/pg";

export const dynamic = "force-dynamic";

type WorkerRow = {
  worker_id: string;
  hostname: string | null;
  last_seen: string | null;
  current_job_id: string | null;
  status: string | null;
};

type WorkerSnapshot = {
  queue: Record<string, unknown> | null;
  workers: WorkerRow[];
} | null;

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

async function loadQueueMetrics(): Promise<Record<string, unknown> | null> {
  const sql = getSql();
  try {
    const rows = await sql`SELECT public.get_pipeline_queue_metrics() AS metrics`;
    return asRecord(rows[0]?.metrics);
  } catch {
    return null;
  }
}

async function loadWorkers(): Promise<WorkerRow[]> {
  const sql = getSql();
  try {
    const rows = await sql`
      SELECT worker_id, hostname, current_job_id, last_seen_at AS last_seen, status
      FROM worker_status
      ORDER BY last_seen_at DESC NULLS LAST
      LIMIT 20
    `;
    return rows.map((row) => ({
      worker_id: String(row.worker_id),
      hostname: row.hostname != null ? String(row.hostname) : null,
      last_seen: row.last_seen != null ? String(row.last_seen) : null,
      current_job_id: row.current_job_id != null ? String(row.current_job_id) : null,
      status: row.status != null ? String(row.status) : null,
    }));
  } catch {
    try {
      const rows = await sql`
        SELECT worker_id, hostname, current_job_id, last_seen, status
        FROM worker_status
        ORDER BY last_seen DESC NULLS LAST
        LIMIT 20
      `;
      return rows.map((row) => ({
        worker_id: String(row.worker_id),
        hostname: row.hostname != null ? String(row.hostname) : null,
        last_seen: row.last_seen != null ? String(row.last_seen) : null,
        current_job_id: row.current_job_id != null ? String(row.current_job_id) : null,
        status: row.status != null ? String(row.status) : null,
      }));
    } catch {
      return [];
    }
  }
}

async function loadWorkerSnapshot(): Promise<WorkerSnapshot> {
  if (!dbAvailable()) return null;
  const [queue, workers] = await Promise.all([loadQueueMetrics(), loadWorkers()]);
  if (queue == null && workers.length === 0) return null;
  return { queue, workers };
}

export async function GET() {
  const timestamp = new Date().toISOString();
  let db = false;
  let worker: WorkerSnapshot = null;

  if (dbAvailable()) {
    try {
      const sql = getSql();
      await sql`SELECT 1 AS ok`;
      db = true;
      worker = await loadWorkerSnapshot();
    } catch {
      db = false;
      worker = null;
    }
  }

  return NextResponse.json({
    ok: db,
    db,
    worker,
    timestamp,
  });
}

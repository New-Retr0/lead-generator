import { readdirSync, readFileSync } from "fs";
import path from "path";
import { listJobs } from "@/lib/jobs";
import { projectRoot } from "@/lib/paths";
import { dbAvailable, getSql } from "@/lib/pg";

const JOB_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Parent job ids that should not still have RUNNING child runs. */
export function terminalJobIds(): Set<string> {
  const ids = new Set<string>();
  for (const job of listJobs(200)) {
    if (
      job.status === "cancelled" ||
      job.status === "failed" ||
      job.status === "interrupted" ||
      job.status === "completed"
    ) {
      ids.add(job.id);
    }
  }
  try {
    const dir = path.join(projectRoot(), "data", "jobs");
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const id = file.slice(0, -5);
      if (!JOB_ID_RE.test(id) || ids.has(id)) continue;
      try {
        const job = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as {
          id?: string;
          status?: string;
          pid?: number | null;
        };
        if (
          job.status === "cancelled" ||
          job.status === "failed" ||
          job.status === "interrupted" ||
          job.status === "completed"
        ) {
          ids.add(id);
          continue;
        }
        if (
          (job.status === "running" || job.status === "pending") &&
          (!job.pid || !pidAlive(job.pid))
        ) {
          ids.add(id);
        }
      } catch {
        // skip
      }
    }
  } catch {
    // best-effort
  }
  return ids;
}

export type RunRepairResult = {
  repaired: number;
  stale: number;
  orphaned: number;
  superseded: number;
};

/**
 * Close RUNNING run rows that cannot still be live:
 * - older than 2h
 * - parent local job is terminal / dead PID
 * - parent pipeline_jobs row is terminal
 * - superseded by a newer cell under the same job_id
 */
export async function repairOrphanedRuns(): Promise<RunRepairResult> {
  if (!dbAvailable()) {
    return { repaired: 0, stale: 0, orphaned: 0, superseded: 0 };
  }
  const sql = getSql();

  // Release claims before closing runs so a crash between statements cannot
  // leave enrichment_status='enriching' under a terminal parent.
  await sql`
    UPDATE leads
    SET enrichment_status = 'partial'
    WHERE lower(COALESCE(enrichment_status, '')) = 'enriching'
      AND last_run_id IN (
        SELECT run_id FROM runs
        WHERE status = 'running'
          AND started_at < now() - interval '2 hours'
      )
  `;
  const stale = await sql`
    UPDATE runs
    SET status = 'failed',
        finished_at = COALESCE(finished_at, now()),
        stop_reason = COALESCE(NULLIF(stop_reason, ''), 'stale')
    WHERE status = 'running'
      AND started_at < now() - interval '2 hours'
    RETURNING run_id
  `;

  const terminal = new Set(terminalJobIds());
  try {
    const workerJobs = await sql`
      SELECT id::text AS id
      FROM pipeline_jobs
      WHERE status IN ('succeeded', 'failed', 'cancelled')
      ORDER BY COALESCE(finished_at, updated_at, created_at) DESC
      LIMIT 500
    `;
    for (const row of workerJobs) {
      if (typeof row.id === "string" && row.id) terminal.add(row.id);
    }
  } catch {
    // pipeline_jobs may be absent / unreachable — local jobs still apply
  }

  const terminalList = [...terminal];
  let orphaned = 0;
  if (terminalList.length > 0) {
    await sql`
      UPDATE leads
      SET enrichment_status = 'partial'
      WHERE lower(COALESCE(enrichment_status, '')) = 'enriching'
        AND last_run_id IN (
          SELECT run_id FROM runs
          WHERE status = 'running'
            AND job_id = ANY(${terminalList}::text[])
        )
    `;
    const rows = await sql`
      UPDATE runs
      SET status = 'failed',
          finished_at = COALESCE(finished_at, now()),
          stop_reason = COALESCE(NULLIF(stop_reason, ''), 'orphaned')
      WHERE status = 'running'
        AND job_id = ANY(${terminalList}::text[])
      RETURNING run_id
    `;
    orphaned = rows.length;
  }

  await sql`
    UPDATE leads
    SET enrichment_status = 'partial'
    WHERE lower(COALESCE(enrichment_status, '')) = 'enriching'
      AND last_run_id IN (
        SELECT older.run_id
        FROM runs AS older
        WHERE older.status = 'running'
          AND older.job_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM runs AS newer
            WHERE newer.job_id = older.job_id
              AND newer.started_at > older.started_at
              AND newer.run_id <> older.run_id
          )
      )
  `;
  const superseded = await sql`
    UPDATE runs AS older
    SET status = 'failed',
        finished_at = COALESCE(older.finished_at, now()),
        stop_reason = COALESCE(NULLIF(older.stop_reason, ''), 'superseded')
    WHERE older.status = 'running'
      AND older.job_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM runs AS newer
        WHERE newer.job_id = older.job_id
          AND newer.started_at > older.started_at
          AND newer.run_id <> older.run_id
      )
    RETURNING older.run_id
  `;

  return {
    repaired: stale.length + orphaned + superseded.length,
    stale: stale.length,
    orphaned,
    superseded: superseded.length,
  };
}

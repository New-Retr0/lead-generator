import { NextResponse } from "next/server";
import { dbAvailable, getSql } from "@/lib/pg";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!dbAvailable()) {
    return NextResponse.json({ error: "DB unavailable" }, { status: 503 });
  }
  const { id: runId } = await context.params;
  if (!runId) {
    return NextResponse.json({ error: "Missing run id" }, { status: 400 });
  }

  const sql = getSql();
  const rows = await sql`
    UPDATE runs
    SET status = 'cancelled',
        finished_at = COALESCE(finished_at, now()),
        stop_reason = COALESCE(NULLIF(stop_reason, ''), 'orphaned')
    WHERE run_id = ${runId}
      AND status = 'running'
    RETURNING run_id
  `;

  return NextResponse.json({ repaired: rows.length > 0 });
}

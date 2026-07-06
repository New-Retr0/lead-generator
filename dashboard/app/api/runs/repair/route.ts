import { NextResponse } from "next/server";
import { dbAvailable, getSql } from "@/lib/pg";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!dbAvailable()) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });
  const sql = getSql();
  const rows = await sql`
    update runs set status = 'failed', finished_at = now()
    where status = 'running' and started_at < now() - interval '2 hours'
    returning run_id`;
  return NextResponse.json({ repaired: rows.length });
}

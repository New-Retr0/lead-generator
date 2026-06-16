import { NextResponse } from "next/server";
import { listRuns } from "@/lib/db";
import { listJobs } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({
      runs: await listRuns(50),
      jobs: listJobs(20),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load runs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

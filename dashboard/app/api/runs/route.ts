import { NextResponse } from "next/server";
import { listRuns } from "@/lib/db";
import { listJobSummaries } from "@/lib/jobs";
import { repairOrphanedRuns } from "@/lib/run-reconcile";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Opportunistic: hard refresh must not show dead RUNNING rows.
    await repairOrphanedRuns();
    const [runs, jobs] = await Promise.all([listRuns(50), listJobSummaries(20)]);
    return NextResponse.json(
      {
        runs,
        jobs,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load runs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

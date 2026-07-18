import { NextResponse } from "next/server";
import { repairOrphanedRuns } from "@/lib/run-reconcile";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await repairOrphanedRuns();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Repair failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

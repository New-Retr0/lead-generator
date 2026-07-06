import { NextResponse } from "next/server";
import { getQueueMetrics, listWorkerHeartbeats } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [metrics, workers] = await Promise.all([
      getQueueMetrics(),
      listWorkerHeartbeats(10),
    ]);
    return NextResponse.json({ metrics, workers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load queue status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

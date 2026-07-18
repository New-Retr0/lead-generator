import { NextResponse } from "next/server";
import { getOverview } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Lightweight yield summary from inventory counts (no separate event store). */
export async function GET() {
  try {
    const overview = await getOverview();
    return NextResponse.json({
      discovered: overview.yield.discovered,
      enriched: overview.yield.enriched,
      verifiedDm: overview.yield.verifiedDm,
      verifiedDmRate: overview.readyToCallRate,
      verifiedThisMonth: overview.verifiedThisMonth,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load yield";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getPipelineTrends } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days") ?? 30)));
    const market = url.searchParams.get("market") ?? undefined;
    const category = url.searchParams.get("category") ?? undefined;

    const trends = await getPipelineTrends(days, {
      market: market || undefined,
      category: category || undefined,
    });

    return NextResponse.json(trends);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load pipeline trends";
    return NextResponse.json(
      {
        stageTrends: [],
        opTrends: [],
        runEfficiency: [],
        stageStatsByRun: [],
        viewsAvailable: false,
        error: message,
      },
      { status: 200 },
    );
  }
}

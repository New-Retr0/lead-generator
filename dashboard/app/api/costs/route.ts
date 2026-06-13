import { NextRequest, NextResponse } from "next/server";
import { getCostSeries } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const days = Number(req.nextUrl.searchParams.get("days") ?? "30");
    return NextResponse.json(getCostSeries(days));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load costs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

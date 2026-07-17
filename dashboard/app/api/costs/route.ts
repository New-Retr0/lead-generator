import { NextRequest, NextResponse } from "next/server";
import { getCostSeries } from "@/lib/db";

export const dynamic = "force-dynamic";

const ALLOWED_DAYS = new Set([7, 30, 90]);

function parseDays(value: string | null): number {
  const parsed = Number(value ?? "30");
  if (!Number.isFinite(parsed)) return 30;
  const days = Math.trunc(parsed);
  return ALLOWED_DAYS.has(days) ? days : 30;
}

export async function GET(req: NextRequest) {
  try {
    const days = parseDays(req.nextUrl.searchParams.get("days"));
    return NextResponse.json(await getCostSeries(days));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load costs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

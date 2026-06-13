import { NextResponse } from "next/server";
import { getOverview } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(getOverview());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load overview";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

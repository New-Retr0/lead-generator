import { NextResponse } from "next/server";
import { listRuns } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({
      runs: await listRuns(50),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load runs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

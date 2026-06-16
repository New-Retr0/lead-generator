import { NextResponse } from "next/server";
import { listRequests } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ requests: await listRequests(50) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load requests";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

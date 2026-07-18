import { NextResponse } from "next/server";
import { startJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const job = startJob("doctor", ["doctor", "--json"]);
    return NextResponse.json({ jobId: job.id, job });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start doctor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { startJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { placeIds?: string[] };
    const placeIds = (body.placeIds ?? []).map((id) => id.trim()).filter(Boolean);

    if (placeIds.length === 0) {
      return NextResponse.json(
        { error: "placeIds array is required" },
        { status: 400 },
      );
    }

    const args = [
      "sync-sheets",
      "--from-db",
      "--place-ids",
      placeIds.join(","),
    ];
    const job = startJob("export", args);
    return NextResponse.json({ jobId: job.id, job });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to export";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

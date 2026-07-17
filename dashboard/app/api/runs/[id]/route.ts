import { NextResponse } from "next/server";
import { getRunDetail } from "@/lib/db";
import { findJobByRunId } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const detail = await getRunDetail(id);
    if (!detail) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const liveJob = findJobByRunId(id);

    // Structured job events carry business names long before leads are
    // upserted to the DB at run end — use them to resolve raw place ids.
    const liveNames: Record<string, string> = {};
    let liveDiscovered: number | null = null;
    if (liveJob) {
      for (const evt of liveJob.events) {
        if (evt.place_id && typeof evt.business === "string" && evt.business) {
          liveNames[evt.place_id] = evt.business;
        }
        if (evt.event === "discovery_done" && typeof evt.count === "number") {
          liveDiscovered = evt.count;
        }
      }
    }

    return NextResponse.json({
      ...detail,
      liveJobId: liveJob?.id ?? null,
      liveJobStatus: liveJob?.status ?? null,
      liveJobFinishedAt: liveJob?.finishedAt ?? null,
      liveNames,
      liveDiscovered,
    }, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load run";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

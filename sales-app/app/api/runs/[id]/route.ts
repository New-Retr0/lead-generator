import { NextResponse } from "next/server";
import { getRunDetail, getLiveRunContext } from "@/lib/db";

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

    const live = detail.run.status === "running" ? await getLiveRunContext(id) : {
      liveJobId: null,
      liveNames: {},
      liveDiscovered: null,
    };

    return NextResponse.json({
      ...detail,
      ...live,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load run";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

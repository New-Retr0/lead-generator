import { NextResponse } from "next/server";
import { buildRunDetailResponse } from "@/lib/run-detail-payload";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const detail = await buildRunDetailResponse(id);
    if (!detail) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    return NextResponse.json(detail, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load run";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

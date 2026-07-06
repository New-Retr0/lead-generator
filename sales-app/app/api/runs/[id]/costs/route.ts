import { NextResponse } from "next/server";
import { getRunCostEvents } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const events = await getRunCostEvents(id);
    return NextResponse.json({ events });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load run costs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

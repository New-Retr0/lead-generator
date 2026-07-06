import { NextResponse } from "next/server";
import { getRunCostEvents } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const events = await getRunCostEvents(id);
  return NextResponse.json({ events });
}

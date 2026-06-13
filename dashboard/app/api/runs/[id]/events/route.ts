import { NextResponse } from "next/server";
import { getRunEvents } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const events = getRunEvents(id);
  return NextResponse.json({ events });
}

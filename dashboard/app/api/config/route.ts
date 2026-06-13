import { NextResponse } from "next/server";
import { getPipelineConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(getPipelineConfig());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load config";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

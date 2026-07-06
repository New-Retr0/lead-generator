import { NextResponse } from "next/server";
import { listConfigFiles } from "@/lib/config-files";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ files: listConfigFiles() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list config files";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

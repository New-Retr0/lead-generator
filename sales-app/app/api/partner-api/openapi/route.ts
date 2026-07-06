import { readFileSync, existsSync } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { projectRoot } from "@/lib/paths";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const candidates = [
      path.join(projectRoot(), "docs", "partner-api.openapi.yaml"),
      path.join(process.cwd(), "docs", "partner-api.openapi.yaml"),
    ];
    const filePath = candidates.find((candidate) => existsSync(candidate));
    if (!filePath) {
      return NextResponse.json({ error: "OpenAPI spec not found" }, { status: 404 });
    }
    const yaml = readFileSync(filePath, "utf8");
    return new NextResponse(yaml, {
      headers: {
        "Content-Type": "application/yaml; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "OpenAPI spec not found";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

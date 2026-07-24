import { NextResponse } from "next/server";
import YAML from "yaml";
import {
  CONFIG_FILE_DESCRIPTIONS,
  readConfigFile,
  writeConfigFile,
} from "@/lib/config-files";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ name: string }> };

function yamlParseError(content: string, err: unknown): { line: number; message: string } {
  const fallback = err instanceof Error ? err.message : "Invalid YAML";
  if (!(err instanceof YAML.YAMLParseError)) {
    return { line: 1, message: fallback };
  }
  const line = (err.linePos?.[0]?.line ?? 1) as number;
  return { line, message: err.message };
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { name } = await params;
    const content = readConfigFile(name);
    return NextResponse.json({
      name,
      content,
      description: CONFIG_FILE_DESCRIPTIONS[name] ?? "Pipeline configuration",
      warnManualEdit: false,
      warning: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read config file";
    const status = message.includes("Invalid") || message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const { name } = await params;
    const body = (await request.json()) as { content?: string };
    if (typeof body.content !== "string") {
      return NextResponse.json({ error: "content string required" }, { status: 400 });
    }

    try {
      YAML.parse(body.content);
    } catch (err) {
      const parsed = yamlParseError(body.content, err);
      return NextResponse.json(
        { error: "Invalid YAML", line: parsed.line, message: parsed.message },
        { status: 422 },
      );
    }

    writeConfigFile(name, body.content);
    return NextResponse.json({ ok: true, name });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to write config file";
    const status = message.includes("Invalid") || message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

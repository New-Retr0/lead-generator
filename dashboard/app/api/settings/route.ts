import { NextResponse } from "next/server";
import { runCli } from "@/lib/cli-exec";
import { updateProjectEnv } from "@/lib/env-write";
import { clearSettingsSchemaCache } from "@/lib/settings-server";

export const dynamic = "force-dynamic";

type SettingsSchemaPayload = {
  schema: {
    properties?: Record<
      string,
      {
        type?: string;
        group?: string;
        secret?: boolean;
        readonly?: boolean;
        help?: string;
      }
    >;
  };
  values: Record<
    string,
    {
      readonly?: boolean;
      env_key?: string;
    }
  >;
  readonly_fields?: string[];
  secret_fields?: string[];
};

let cachedPayload: SettingsSchemaPayload | null = null;
let cachedAt = 0;
const CACHE_MS = 30_000;

async function loadSettingsSchema(force = false): Promise<SettingsSchemaPayload> {
  const now = Date.now();
  if (!force && cachedPayload && now - cachedAt < CACHE_MS) {
    return cachedPayload;
  }

  const { stdout, stderr, code } = await runCli(["settings-schema"]);
  if (code !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || "settings-schema failed");
  }

  cachedPayload = JSON.parse(stdout) as SettingsSchemaPayload;
  cachedAt = now;
  return cachedPayload;
}

export async function GET() {
  try {
    const payload = await loadSettingsSchema();
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load settings schema";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      updates?: Record<string, string | number | boolean | null>;
    };
    const updates = body.updates;
    if (!updates || typeof updates !== "object") {
      return NextResponse.json({ error: "updates object required" }, { status: 400 });
    }

    const schema = await loadSettingsSchema(true);
    const readonly = new Set(schema.readonly_fields ?? []);
    for (const field of Object.keys(updates)) {
      if (!(field in (schema.values ?? {}))) {
        return NextResponse.json({ error: `Unknown setting: ${field}` }, { status: 400 });
      }
      if (readonly.has(field) || schema.values[field]?.readonly) {
        return NextResponse.json({ error: `Read-only setting: ${field}` }, { status: 400 });
      }
    }

    const result = updateProjectEnv(updates);
    cachedPayload = null;
    cachedAt = 0;
    clearSettingsSchemaCache();

    const refreshed = await loadSettingsSchema(true);
    return NextResponse.json({ ok: true, ...result, ...refreshed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

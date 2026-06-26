import { NextRequest, NextResponse } from "next/server";
import { listPipelineJobs } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import type { PipelineJobKind } from "@/lib/types";

export const dynamic = "force-dynamic";

const JOB_KINDS = new Set<PipelineJobKind>(["doctor", "run", "run_campaign", "request"]);

function isJobKind(value: unknown): value is PipelineJobKind {
  return typeof value === "string" && JOB_KINDS.has(value as PipelineJobKind);
}

export async function GET(req: NextRequest) {
  try {
    const limit = req.nextUrl.searchParams.has("limit")
      ? Number(req.nextUrl.searchParams.get("limit"))
      : 25;
    const jobs = await listPipelineJobs(Number.isFinite(limit) ? limit : 25);
    return NextResponse.json({ jobs });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load jobs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { kind?: unknown; payload?: unknown };
    if (!isJobKind(body.kind)) {
      return NextResponse.json({ error: "Invalid job kind" }, { status: 400 });
    }
    const payload =
      body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
        ? (body.payload as Record<string, unknown>)
        : {};

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("enqueue_pipeline_job", {
      job_kind: body.kind,
      job_payload: payload,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ id: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to enqueue job";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

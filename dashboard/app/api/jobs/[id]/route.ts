import { cancelJob, getJob, isValidJobId, jobFirstSeq, loadPersistedJob } from "@/lib/jobs";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!isValidJobId(id)) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }
  const job = getJob(id) ?? loadPersistedJob(id);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  const firstSeq = jobFirstSeq(id);
  return NextResponse.json({
    job,
    nextSeq: firstSeq + job.logs.length,
  });
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!isValidJobId(id)) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }
  const job = (await cancelJob(id)) ?? loadPersistedJob(id);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  return NextResponse.json({ job });
}

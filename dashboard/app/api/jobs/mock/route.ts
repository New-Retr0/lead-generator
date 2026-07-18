import { NextResponse } from "next/server";
import { JobConcurrencyError } from "@/lib/jobs";
import { isMockScenario, MOCK_SCENARIOS, startMockJob } from "@/lib/mock-job";

export const dynamic = "force-dynamic";

/** Dev-only: launch a scripted fake run so the full SSE/UI path can be
 * exercised with zero API keys. Never available in production builds. */
export async function POST(req: Request) {
  // Production builds stay closed unless explicitly opened for local E2E
  // (Playwright uses `next start` so parallel `pkill … next dev` cannot kill it).
  if (
    process.env.NODE_ENV === "production" &&
    process.env.E2E_ALLOW_MOCK !== "1"
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const body = (await req.json().catch(() => ({}))) as { scenario?: string };
    const scenario = body.scenario ?? "happy";
    if (!isMockScenario(scenario)) {
      return NextResponse.json(
        { error: `scenario must be one of: ${MOCK_SCENARIOS.join(", ")}` },
        { status: 400 },
      );
    }
    const job = startMockJob(scenario);
    return NextResponse.json({ jobId: job.id, job });
  } catch (err) {
    if (err instanceof JobConcurrencyError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    const message = err instanceof Error ? err.message : "Failed to start mock job";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

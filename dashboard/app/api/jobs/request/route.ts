import { NextRequest, NextResponse } from "next/server";
import { startJob } from "@/lib/jobs";
import { getRequestCreditBudget } from "@/lib/request-budget";
import type { RequestSpec } from "@/lib/types";

export const dynamic = "force-dynamic";

type RequestBody = {
  /** Natural-language mode */
  prompt?: string;
  /** Structured builder mode: bypasses LLM parsing via --spec-json */
  spec?: RequestSpec;
  dryRun?: boolean;
};

const DASHBOARD_REQUEST_DEFAULTS = {
  min_lead_score: 0,
  recurring_only: false,
} satisfies Pick<RequestSpec, "min_lead_score" | "recurring_only">;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RequestBody;
    const requestBudget = await getRequestCreditBudget();

    const args: string[] = ["request"];

    if (body.spec) {
      const spec = body.spec;
      if (spec.market_keys.length === 0 || spec.categories.length === 0) {
        return NextResponse.json(
          { error: "Select at least one market and one category" },
          { status: 400 },
        );
      }

      const normalizedSpec: RequestSpec = {
        ...spec,
        ...DASHBOARD_REQUEST_DEFAULTS,
        budget: {
          max_firecrawl_credits: requestBudget.maxFirecrawlCredits,
        },
      };
      args.push("--spec-json", JSON.stringify(normalizedSpec));
    } else if (body.prompt?.trim()) {
      args.push(body.prompt.trim());
    } else {
      return NextResponse.json(
        { error: "prompt or spec is required" },
        { status: 400 },
      );
    }

    if (body.dryRun) {
      args.push("--dry-run");
    } else {
      args.push("--yes");
    }

    const job = startJob("request", args, {
      PALLARES_REQUEST_MAX_FIRECRAWL_CREDITS: String(
        requestBudget.maxFirecrawlCredits,
      ),
    });
    return NextResponse.json({ jobId: job.id, job });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start request";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

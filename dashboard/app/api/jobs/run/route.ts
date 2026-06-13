import { NextRequest, NextResponse } from "next/server";
import { getPipelineConfig } from "@/lib/config";
import { JobConcurrencyError, startJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

const ALLOWED_RUN_TYPES = new Set(["run", "run-campaign", "smoke-sample"]);

type RunBody = {
  runType?: "run" | "run-campaign" | "smoke-sample";
  market?: string;
  category?: string;
  allCategories?: boolean;
  campaign?: string;
  limit?: number;
  discoverOnly?: boolean;
};

function parseLimit(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 500) return null;
  return n;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RunBody;

    const runType = body.runType ?? "run";
    if (!ALLOWED_RUN_TYPES.has(runType)) {
      return NextResponse.json({ error: "Invalid runType" }, { status: 400 });
    }

    const config = getPipelineConfig();
    const marketKeys = new Set(config.markets.map((m) => m.key));
    const categoryKeys = new Set(config.categories.map((c) => c.key));
    const campaignKeys = new Set(config.campaigns.map((c) => c.key));

    const args: string[] = [runType];

    if (runType === "run") {
      if (!body.market) {
        return NextResponse.json({ error: "market is required" }, { status: 400 });
      }
      if (!marketKeys.has(body.market)) {
        return NextResponse.json({ error: "Invalid market" }, { status: 400 });
      }
      args.push("--market", body.market);
      if (body.allCategories) {
        args.push("--all-categories");
      } else if (body.category) {
        if (!categoryKeys.has(body.category)) {
          return NextResponse.json({ error: "Invalid category" }, { status: 400 });
        }
        args.push("--category", body.category);
      } else {
        return NextResponse.json(
          { error: "category or allCategories is required" },
          { status: 400 },
        );
      }
    } else if (runType === "run-campaign") {
      if (body.campaign && !campaignKeys.has(body.campaign)) {
        return NextResponse.json({ error: "Invalid campaign" }, { status: 400 });
      }
      if (body.market && !marketKeys.has(body.market)) {
        return NextResponse.json({ error: "Invalid market" }, { status: 400 });
      }
      if (body.category && !categoryKeys.has(body.category)) {
        return NextResponse.json({ error: "Invalid category" }, { status: 400 });
      }
      if (body.campaign) args.push("--campaign", body.campaign);
      if (body.market) args.push("--market", body.market);
      if (body.category) args.push("--category", body.category);
    } else if (runType === "smoke-sample") {
      if (body.campaign && !campaignKeys.has(body.campaign)) {
        return NextResponse.json({ error: "Invalid campaign" }, { status: 400 });
      }
      if (body.market && !marketKeys.has(body.market)) {
        return NextResponse.json({ error: "Invalid market" }, { status: 400 });
      }
      if (body.campaign) args.push("--campaign", body.campaign);
      if (body.market) args.push("--market", body.market);
    }

    const limit = parseLimit(body.limit);
    if (body.limit !== undefined && body.limit !== null && limit === null) {
      return NextResponse.json(
        { error: "limit must be an integer between 1 and 500" },
        { status: 400 },
      );
    }
    if (limit) args.push("--limit", String(limit));
    if (body.discoverOnly) args.push("--discover-only");
    args.push("--no-sheets");

    const job = startJob("run", args);
    return NextResponse.json({ jobId: job.id, job });
  } catch (err) {
    if (err instanceof JobConcurrencyError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    const message = err instanceof Error ? err.message : "Failed to start run";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

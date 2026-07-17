import { NextResponse } from "next/server";
import {
  getFirecrawlCreditUsd,
  getFirecrawlPlans,
  inferFirecrawlPlan,
} from "@/lib/config";
import { getCreditBalances } from "@/lib/db";
import { loadProjectEnv } from "@/lib/env";
import type { FirecrawlPlan } from "@/lib/types";

export const dynamic = "force-dynamic";

type CreditsResponse = {
  firecrawl: {
    remaining: number | null;
    plan: number | null;
    used: number | null;
    planName: string | null;
    creditUsd: number | null;
    inferredPlan: FirecrawlPlan | null;
    plans: FirecrawlPlan[];
    billingPeriodStart: string | null;
    billingPeriodEnd: string | null;
    queue: {
      jobsInQueue: number | null;
      activeJobsInQueue: number | null;
      waitingJobsInQueue: number | null;
      maxConcurrency: number | null;
      mostRecentSuccess: string | null;
      live: boolean;
    };
    live: boolean;
  };
  aiGateway: {
    balanceUsd: number | null;
    totalUsedUsd: number | null;
    live: boolean;
  };
  cachedAt: string;
};

let cache: { at: number; data: CreditsResponse } | null = null;
const CACHE_MS = 60_000;

async function fetchFirecrawlLive(apiKey: string) {
  const [usageRes, queueRes] = await Promise.all([
    fetch("https://api.firecrawl.dev/v2/team/credit-usage", {
      headers: { Authorization: `Bearer ${apiKey}` },
      next: { revalidate: 0 },
    }),
    fetch("https://api.firecrawl.dev/v2/team/queue-status", {
      headers: { Authorization: `Bearer ${apiKey}` },
      next: { revalidate: 0 },
    }),
  ]);
  if (!usageRes.ok) throw new Error(`Firecrawl HTTP ${usageRes.status}`);
  const body = (await usageRes.json()) as {
    data?: {
      remainingCredits?: number;
      planCredits?: number;
      billingPeriodStart?: string;
      billingPeriodEnd?: string;
    };
  };
  const data = body.data ?? {};
  const remaining = data.remainingCredits ?? null;
  const plan = data.planCredits ?? null;
  const used =
    remaining != null && plan != null ? Math.max(0, plan - remaining) : null;
  let queue = {
    jobsInQueue: null as number | null,
    activeJobsInQueue: null as number | null,
    waitingJobsInQueue: null as number | null,
    maxConcurrency: null as number | null,
    mostRecentSuccess: null as string | null,
    live: false,
  };
  if (queueRes.ok) {
    const queueBody = (await queueRes.json()) as {
      jobsInQueue?: number;
      activeJobsInQueue?: number;
      waitingJobsInQueue?: number;
      maxConcurrency?: number;
      mostRecentSuccess?: string | null;
    };
    queue = {
      jobsInQueue: queueBody.jobsInQueue ?? null,
      activeJobsInQueue: queueBody.activeJobsInQueue ?? null,
      waitingJobsInQueue: queueBody.waitingJobsInQueue ?? null,
      maxConcurrency: queueBody.maxConcurrency ?? null,
      mostRecentSuccess: queueBody.mostRecentSuccess ?? null,
      live: true,
    };
  }
  const inferredPlan = inferFirecrawlPlan({
    planCredits: plan,
    maxConcurrency: queue.maxConcurrency,
  });
  return {
    remaining,
    plan,
    used,
    planName: inferredPlan?.name ?? null,
    creditUsd:
      inferredPlan && inferredPlan.monthlyUsd > 0 && inferredPlan.monthlyCredits > 0
        ? inferredPlan.monthlyUsd / inferredPlan.monthlyCredits
        : getFirecrawlCreditUsd(),
    inferredPlan,
    billingPeriodStart: data.billingPeriodStart ?? null,
    billingPeriodEnd: data.billingPeriodEnd ?? null,
    queue,
  };
}

function firecrawlUsed(
  remaining: number | null,
  plan: number | null,
  snapshotUsed: number | null,
): number | null {
  if (remaining != null && plan != null) {
    return Math.max(0, plan - remaining);
  }
  return snapshotUsed;
}

async function fetchAiGatewayLive(apiKey: string) {
  const res = await fetch("https://ai-gateway.vercel.sh/v1/credits", {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`AI Gateway HTTP ${res.status}`);
  const body = (await res.json()) as { balance?: number; total_used?: number };
  return {
    balanceUsd: typeof body.balance === "number" ? body.balance : null,
    totalUsedUsd: typeof body.total_used === "number" ? body.total_used : null,
  };
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) {
    return NextResponse.json(cache.data);
  }

  const env = loadProjectEnv();
  const firecrawlKey = env.FIRECRAWL_API_KEY ?? process.env.FIRECRAWL_API_KEY;
  const aiKey = env.AI_GATEWAY_API_KEY ?? process.env.AI_GATEWAY_API_KEY;
  const snapshots = await getCreditBalances();
  const fcSnap = snapshots.find((b) => b.provider === "firecrawl");
  const aiSnap = snapshots.find((b) => b.provider === "ai_gateway");

  let firecrawl: CreditsResponse["firecrawl"] = {
    remaining: fcSnap?.remaining ?? null,
    plan: fcSnap?.plan ?? null,
    used: firecrawlUsed(
      fcSnap?.remaining ?? null,
      fcSnap?.plan ?? null,
      fcSnap?.used ?? null,
    ),
    planName: fcSnap?.planName ?? inferFirecrawlPlan({ planCredits: fcSnap?.plan ?? null })?.name ?? null,
    creditUsd: fcSnap?.creditUsd ?? getFirecrawlCreditUsd(),
    inferredPlan: inferFirecrawlPlan({ planCredits: fcSnap?.plan ?? null }),
    plans: getFirecrawlPlans(),
    billingPeriodStart: null as string | null,
    billingPeriodEnd: fcSnap?.billingPeriodEnd ?? null,
    queue: {
      jobsInQueue: null,
      activeJobsInQueue: null,
      waitingJobsInQueue: null,
      maxConcurrency: null,
      mostRecentSuccess: null,
      live: false,
    },
    live: false,
  };
  let aiGateway = {
    balanceUsd: aiSnap?.remaining ?? null,
    totalUsedUsd: aiSnap?.used ?? null,
    live: false,
  };

  if (firecrawlKey) {
    try {
      const live = await fetchFirecrawlLive(firecrawlKey);
      firecrawl = { ...live, plans: getFirecrawlPlans(), live: true };
    } catch {
      // snapshot fallback
    }
  }

  if (aiKey) {
    try {
      const live = await fetchAiGatewayLive(aiKey);
      aiGateway = { ...live, live: true };
    } catch {
      // snapshot fallback
    }
  }

  const data: CreditsResponse = {
    firecrawl,
    aiGateway,
    cachedAt: new Date().toISOString(),
  };
  cache = { at: now, data };
  return NextResponse.json(data);
}

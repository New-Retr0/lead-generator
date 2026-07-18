import { NextResponse } from "next/server";
import {
  getFirecrawlCreditUsd,
  getFirecrawlPlans,
  inferFirecrawlPlan,
} from "@/lib/config";
import { getCreditBalances } from "@/lib/db";
import { loadProjectEnv } from "@/lib/env";
import { fetchFirecrawlLive, type FirecrawlLiveBalance } from "@/lib/firecrawl-live";
import type { FirecrawlPlan } from "@/lib/types";

export const dynamic = "force-dynamic";

type CreditsResponse = {
  firecrawl: {
    remaining: number | null;
    plan: number | null;
    used: number | null;
    extraCredits: number | null;
    planName: string | null;
    creditUsd: number | null;
    inferredPlan: FirecrawlPlan | null;
    plans: FirecrawlPlan[];
    billingPeriodStart: string | null;
    billingPeriodEnd: string | null;
    planConcurrency: number | null;
    queue: FirecrawlLiveBalance["queue"];
    live: boolean;
  };
  cachedAt: string;
};

let cache: { at: number; data: CreditsResponse } | null = null;
const CACHE_MS = 60_000;

function firecrawlUsed(
  remaining: number | null,
  plan: number | null,
  snapshotUsed: number | null,
): number | null {
  if (remaining != null && plan != null) {
    // When remaining exceeds plan (recharge/extra), used is still cycle spend vs plan.
    return Math.max(0, plan - Math.min(remaining, plan));
  }
  return snapshotUsed;
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) {
    return NextResponse.json(cache.data);
  }

  const env = loadProjectEnv();
  const firecrawlKey = env.FIRECRAWL_API_KEY ?? process.env.FIRECRAWL_API_KEY;
  const snapshots = await getCreditBalances();
  const fcSnap = snapshots.find((b) => b.provider === "firecrawl");

  let firecrawl: CreditsResponse["firecrawl"] = {
    remaining: fcSnap?.remaining ?? null,
    plan: fcSnap?.plan ?? null,
    used: firecrawlUsed(
      fcSnap?.remaining ?? null,
      fcSnap?.plan ?? null,
      fcSnap?.used ?? null,
    ),
    extraCredits:
      fcSnap?.remaining != null &&
      fcSnap?.plan != null &&
      fcSnap.remaining > fcSnap.plan
        ? fcSnap.remaining - fcSnap.plan
        : null,
    planName:
      fcSnap?.planName ??
      inferFirecrawlPlan({ planCredits: fcSnap?.plan ?? null })?.name ??
      null,
    creditUsd: fcSnap?.creditUsd ?? getFirecrawlCreditUsd(),
    inferredPlan: inferFirecrawlPlan({ planCredits: fcSnap?.plan ?? null }),
    plans: getFirecrawlPlans(),
    billingPeriodStart: null,
    billingPeriodEnd: fcSnap?.billingPeriodEnd ?? null,
    planConcurrency:
      inferFirecrawlPlan({ planCredits: fcSnap?.plan ?? null })?.concurrentBrowsers ??
      null,
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

  if (firecrawlKey) {
    try {
      const live = await fetchFirecrawlLive(firecrawlKey);
      firecrawl = {
        remaining: live.remaining,
        plan: live.plan,
        used: live.used,
        extraCredits: live.extraCredits,
        planName: live.planName,
        creditUsd: live.creditUsd,
        inferredPlan: live.inferredPlan,
        plans: live.plans,
        billingPeriodStart: live.billingPeriodStart,
        billingPeriodEnd: live.billingPeriodEnd,
        planConcurrency: live.planConcurrency,
        queue: live.queue,
        live: true,
      };
    } catch {
      // snapshot fallback already set
    }
  }

  const data: CreditsResponse = {
    firecrawl,
    cachedAt: new Date().toISOString(),
  };
  cache = { at: now, data };
  return NextResponse.json(data);
}

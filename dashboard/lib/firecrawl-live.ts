import {
  getFirecrawlCreditUsd,
  getFirecrawlPlans,
  inferFirecrawlPlan,
} from "@/lib/config";
import { dbAvailable, getSql } from "@/lib/pg";
import type { FirecrawlPlan } from "@/lib/types";

export type FirecrawlQueueStatus = {
  jobsInQueue: number | null;
  activeJobsInQueue: number | null;
  waitingJobsInQueue: number | null;
  maxConcurrency: number | null;
  mostRecentSuccess: string | null;
  live: boolean;
};

export type FirecrawlLiveBalance = {
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
  queue: FirecrawlQueueStatus;
  /** Effective concurrency = API plan limit (optional env throttle can only go lower). */
  planConcurrency: number | null;
  live: boolean;
  snapshotAt: string;
};

const emptyQueue = (): FirecrawlQueueStatus => ({
  jobsInQueue: null,
  activeJobsInQueue: null,
  waitingJobsInQueue: null,
  maxConcurrency: null,
  mostRecentSuccess: null,
  live: false,
});

async function persistCreditSnapshot(payload: {
  remaining: number | null;
  used: number | null;
  snapshot: Record<string, unknown>;
}): Promise<void> {
  if (!dbAvailable()) return;
  try {
    const sql = getSql();
    await sql`
      INSERT INTO credit_snapshots (
        provider, remaining_credits, used_credits, snapshot_json, created_at
      ) VALUES (
        'firecrawl',
        ${payload.remaining},
        ${payload.used},
        ${sql.json(payload.snapshot as never)},
        NOW()
      )
    `;
  } catch {
    // Snapshot persistence is best-effort — live UI still works without it.
  }
}

export async function fetchFirecrawlLive(apiKey: string): Promise<FirecrawlLiveBalance> {
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

  if (!usageRes.ok) {
    throw new Error(`Firecrawl credit-usage HTTP ${usageRes.status}`);
  }

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
  const extraCredits =
    remaining != null && plan != null && remaining > plan
      ? remaining - plan
      : null;

  let queue = emptyQueue();
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
  const planConcurrency =
    queue.maxConcurrency ?? inferredPlan?.concurrentBrowsers ?? null;
  const creditUsd =
    inferredPlan && inferredPlan.monthlyUsd > 0 && inferredPlan.monthlyCredits > 0
      ? inferredPlan.monthlyUsd / inferredPlan.monthlyCredits
      : getFirecrawlCreditUsd();

  const snapshotAt = new Date().toISOString();
  const snapshot = {
    remainingCredits: remaining,
    planCredits: plan,
    usedCredits: used,
    extraCredits,
    billingPeriodStart: data.billingPeriodStart ?? null,
    billingPeriodEnd: data.billingPeriodEnd ?? null,
    maxConcurrency: planConcurrency,
    planName: inferredPlan?.name ?? null,
    queue,
    fetchedAt: snapshotAt,
  };

  await persistCreditSnapshot({ remaining, used, snapshot });

  return {
    remaining,
    plan,
    used,
    extraCredits,
    planName: inferredPlan?.name ?? null,
    creditUsd,
    inferredPlan,
    plans: getFirecrawlPlans(),
    billingPeriodStart: data.billingPeriodStart ?? null,
    billingPeriodEnd: data.billingPeriodEnd ?? null,
    queue,
    planConcurrency,
    live: true,
    snapshotAt,
  };
}

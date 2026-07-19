import { Suspense } from "react";
import { CommandCenterClient } from "@/components/command-center-client";
import type { AttentionItem } from "@/components/overview/attention-strip";
import { CommandCenterFallback } from "@/components/overview/command-center-fallback";
import {
  getCostSeries,
  getCreditBalances,
  getOverview,
  listRequests,
  listRuns,
} from "@/lib/db";
import { loadProjectEnv } from "@/lib/env";
import { fetchFirecrawlLive } from "@/lib/firecrawl-live";
import { listJobs } from "@/lib/jobs";
import { repairOrphanedRunsThrottled } from "@/lib/run-reconcile";
import type { CostDayRow, RequestRow, RunRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CommandCenterPage() {
  let stats = null;
  let credits = null;
  let runs: RunRow[] = [];
  let requests: RequestRow[] = [];
  let costDays: CostDayRow[] = [];
  let usdByProviderMonth: { provider: string; usd: number }[] = [];
  let usdByProvider7d: { provider: string; usd: number }[] = [];
  let enrichedLeads = 0;
  let attentionItems: AttentionItem[] = [];
  let error = "";

  try {
    const env = loadProjectEnv();
    const firecrawlKey = env.FIRECRAWL_API_KEY ?? process.env.FIRECRAWL_API_KEY;
    // Everything in parallel — sequential repair/Firecrawl was stacking seconds
    // onto every home navigation.
    const liveFirecrawl = firecrawlKey
      ? Promise.race([
          fetchFirecrawlLive(firecrawlKey),
          new Promise<null>((resolve) => {
            setTimeout(() => resolve(null), 1200);
          }),
        ]).catch(() => null)
      : Promise.resolve(null);

    const [, statsResult, runsResult, requestsResult, costSeries, creditBalances, live] =
      await Promise.all([
        repairOrphanedRunsThrottled(),
        getOverview(),
        listRuns(10),
        listRequests(5),
        getCostSeries(14),
        getCreditBalances(),
        liveFirecrawl,
      ]);

    const weekDays = costSeries.byDay.slice(-7);
    const usdThisWeek = weekDays.reduce((s, d) => s + d.usd, 0);
    const fcSnap = creditBalances.find((b) => b.provider === "firecrawl");
    let fcBalance = fcSnap
      ? {
          remaining: fcSnap.remaining,
          used: fcSnap.used,
          plan: fcSnap.plan,
          planName: fcSnap.planName ?? null,
          billingPeriodEnd: fcSnap.billingPeriodEnd,
          snapshotAt: fcSnap.snapshotAt,
          extraCredits:
            fcSnap.remaining != null &&
            fcSnap.plan != null &&
            fcSnap.remaining > fcSnap.plan
              ? fcSnap.remaining - fcSnap.plan
              : null,
          planConcurrency: null as number | null,
          live: false,
        }
      : null;
    if (live) {
      fcBalance = {
        remaining: live.remaining,
        used: live.used,
        plan: live.plan,
        planName: live.planName,
        billingPeriodEnd: live.billingPeriodEnd,
        snapshotAt: live.snapshotAt,
        extraCredits: live.extraCredits,
        planConcurrency: live.planConcurrency,
        live: true,
      };
    }

    enrichedLeads = statsResult.enrichedLeads;
    usdByProviderMonth = statsResult.usdByProvider.map((r) => ({
      provider: r.provider,
      usd: r.usd,
    }));

    const sum7d = (field: keyof CostDayRow) =>
      weekDays.reduce((s, d) => s + Number(d[field] ?? 0), 0);

    const browser7d = sum7d("browserUseUsd");
    const places7d = sum7d("googlePlacesUsd");
    const firecrawl7d = Math.max(0, usdThisWeek - browser7d - places7d);

    usdByProvider7d = [
      { provider: "firecrawl", usd: firecrawl7d },
      { provider: "browser_use", usd: browser7d },
      { provider: "google_places", usd: places7d },
    ].filter((r) => r.usd > 0);

    stats = {
      totalLeads: statsResult.totalLeads,
      readyToCall: statsResult.readyToCall,
      readyToCallRate: statsResult.readyToCallRate,
      partialInventory: statsResult.partialInventory,
      verifiedThisMonth: statsResult.verifiedThisMonth,
      creditsThisMonth: statsResult.creditsThisMonth,
      creditsPerVerifiedDm: statsResult.creditsPerVerifiedDm,
      creditsPerVerifiedDmCaveat: statsResult.creditsPerVerifiedDmCaveat,
      usdPerVerifiedDm: statsResult.usdPerVerifiedDm,
      minutesPerVerifiedDm: statsResult.minutesPerVerifiedDm,
      usdThisWeek,
      enrichedLeads,
    };
    credits = {
      firecrawlRemaining: fcBalance?.remaining ?? 0,
      firecrawlUsed: fcBalance?.used ?? null,
      firecrawlPlan: fcBalance?.plan ?? null,
      firecrawlPlanName: fcBalance?.planName ?? null,
      firecrawlBillingEnd: fcBalance?.billingPeriodEnd ?? null,
      firecrawlSnapshotAt: fcBalance?.snapshotAt ?? null,
      firecrawlExtraCredits: fcBalance?.extraCredits ?? null,
      firecrawlPlanConcurrency: fcBalance?.planConcurrency ?? null,
      firecrawlLive: fcBalance?.live ?? false,
    };
    runs = runsResult;
    requests = requestsResult;
    costDays = costSeries.byDay;

    const runningJobs = listJobs(20).filter(
      (j) => j.status === "running" || j.status === "pending",
    ).length;
    const cellsInFlight = (runsResult ?? []).filter(
      (r) => r.status === "running",
    ).length;

    attentionItems = [
      {
        key: "running",
        label: "Active jobs",
        count: runningJobs,
        href: "/launch",
        tone: "warning",
        hint:
          runningJobs > 0
            ? `${cellsInFlight} market cell${cellsInFlight === 1 ? "" : "s"} in flight`
            : "No local CLI executions running — launch when ready",
      },
      {
        key: "ready",
        label: "Verified DMs",
        count: statsResult.readyToCall,
        href: "/data?inventory=ready",
        tone: "success",
        hint: "Named decision-makers with grounded local phones — the sellable queue",
      },
      {
        key: "partial",
        label: "Partial inventory",
        count: statsResult.partialInventory,
        href: "/data?inventory=partial",
        tone: "secondary",
        hint: "Phone on file, still missing a verified named DM — upgrade candidates",
      },
    ];
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load overview";
    runs = [];
    requests = [];
    costDays = [];
    // Keep Attention strip mounted for E2E + empty-state UX when DB is down.
    attentionItems = [
      {
        key: "running",
        label: "Active jobs",
        count: 0,
        href: "/runs",
        tone: "warning",
        hint: "CLI jobs currently running or queued",
      },
      {
        key: "ready",
        label: "Verified DMs",
        count: 0,
        href: "/data?inventory=ready",
        tone: "success",
        hint: "Grounded named decision-makers with local callable phones",
      },
      {
        key: "partial",
        label: "Partial inventory",
        count: 0,
        href: "/data?inventory=partial",
        tone: "secondary",
        hint: "Callable phone on file without a verified named DM",
      },
    ];
  }

  return (
    <Suspense fallback={<CommandCenterFallback />}>
      <CommandCenterClient
        stats={stats}
        credits={credits}
        runs={runs ?? []}
        requests={requests ?? []}
        costDays={costDays ?? []}
        usdByProvider7d={usdByProvider7d}
        usdByProviderMonth={usdByProviderMonth}
        attentionItems={attentionItems}
        error={error}
      />
    </Suspense>
  );
}

import { Suspense } from "react";
import { CommandCenterClient } from "@/components/command-center-client";
import {
  getCostSeries,
  getCreditBalances,
  getOverview,
  listRequests,
  listRuns,
} from "@/lib/db";
import type { CostDayRow, RequestRow, RunRow } from "@/lib/types";

export default async function CommandCenterPage() {
  let stats = null;
  let credits = null;
  let runs: RunRow[] = [];
  let requests: RequestRow[] = [];
  let costDays: CostDayRow[] = [];
  let usdByProviderMonth: { provider: string; usd: number }[] = [];
  let usdByProvider7d: { provider: string; usd: number }[] = [];
  let enrichedLeads = 0;
  let error = "";

  try {
    const [statsResult, runsResult, requestsResult, costSeries, creditBalances] =
      await Promise.all([
        getOverview(),
        listRuns(10),
        listRequests(5),
        getCostSeries(14),
        getCreditBalances(),
      ]);

    const weekDays = costSeries.byDay.slice(-7);
    const usdThisWeek = weekDays.reduce((s, d) => s + d.usd, 0);
    const fcBalance = creditBalances.find((b) => b.provider === "firecrawl");
    const aiBalance = creditBalances.find((b) => b.provider === "ai_gateway");

    enrichedLeads = statsResult.enrichedLeads;
    usdByProviderMonth = statsResult.usdByProvider.map((r) => ({
      provider: r.provider,
      usd: r.usd,
    }));

    const sum7d = (field: keyof CostDayRow) =>
      weekDays.reduce((s, d) => s + Number(d[field] ?? 0), 0);

    const browser7d = sum7d("browserUseUsd");
    const gateway7d = sum7d("aiGatewayUsd");
    const places7d = sum7d("googlePlacesUsd");
    const firecrawl7d = Math.max(0, usdThisWeek - browser7d - gateway7d - places7d);

    usdByProvider7d = [
      { provider: "firecrawl", usd: firecrawl7d },
      { provider: "browser_use", usd: browser7d },
      { provider: "ai_gateway", usd: gateway7d },
      { provider: "google_places", usd: places7d },
    ].filter((r) => r.usd > 0);

    stats = {
      totalLeads: statsResult.totalLeads,
      readyToCall: statsResult.readyToCall,
      readyToCallRate: statsResult.readyToCallRate,
      creditsThisMonth: statsResult.creditsThisMonth,
      usdThisWeek,
      enrichedLeads,
      aiGatewayUsdThisMonth: statsResult.aiGatewayUsdThisMonth,
    };
    credits = {
      firecrawlRemaining: fcBalance?.remaining ?? 0,
      aiGatewayBalance: aiBalance?.remaining ?? null,
      firecrawlUsed: fcBalance?.used ?? null,
      firecrawlPlan: fcBalance?.plan ?? null,
      firecrawlBillingEnd: fcBalance?.billingPeriodEnd ?? null,
      firecrawlSnapshotAt: fcBalance?.snapshotAt ?? null,
      aiGatewayUsed: aiBalance?.used ?? null,
    };
    runs = runsResult;
    requests = requestsResult;
    costDays = costSeries.byDay;
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load overview";
    runs = [];
    requests = [];
    costDays = [];
  }

  return (
    <Suspense fallback={null}>
      <CommandCenterClient
        stats={stats}
        credits={credits}
        runs={runs ?? []}
        requests={requests ?? []}
        costDays={costDays ?? []}
        usdByProvider7d={usdByProvider7d}
        usdByProviderMonth={usdByProviderMonth}
        error={error}
      />
    </Suspense>
  );
}

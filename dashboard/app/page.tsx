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

    stats = {
      totalLeads: statsResult.totalLeads,
      readyToCall: statsResult.readyToCall,
      readyToCallRate: statsResult.readyToCallRate,
      creditsThisMonth: statsResult.creditsThisMonth,
      usdThisWeek,
    };
    credits = {
      firecrawlRemaining: fcBalance?.remaining ?? 0,
      aiGatewayBalance: aiBalance?.remaining ?? null,
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
        error={error}
      />
    </Suspense>
  );
}

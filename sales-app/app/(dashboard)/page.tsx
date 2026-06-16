import { Suspense } from "react";
import Link from "next/link";
import { Activity, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { OverviewStatCards } from "@/components/overview/overview-stat-cards";
import { SpendChartLazy } from "@/components/overview/spend-chart-lazy";
import { RunStatusBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getCostSeries,
  getOverview,
  listRequests,
  listRuns,
} from "@/lib/db";
import {
  formatCredits,
  formatFirecrawlBalanceSub,
  formatOverviewSpendSub,
  formatPct,
  formatProvider,
  formatUsd,
} from "@/lib/utils";

export default async function OverviewPage() {
  let stats;
  let runs;
  let requests;
  let costDays;
  let error = "";

  try {
    const [statsResult, runsResult, requestsResult, costSeries] = await Promise.all([
      getOverview(),
      listRuns(5),
      listRequests(5),
      getCostSeries(14),
    ]);
    stats = statsResult;
    runs = runsResult;
    requests = requestsResult;
    costDays = costSeries.byDay;
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load overview";
  }

  const totalUsd = stats?.usdByProvider.reduce((s, p) => s + p.usd, 0) ?? 0;
  const firecrawlBalance = stats?.balances.find((b) => b.provider === "firecrawl");

  const totalLeadsDetails = stats
    ? [
        { label: "Enriched", value: String(stats.enrichedLeads) },
        {
          label: "% enriched",
          value: formatPct(
            stats.totalLeads > 0 ? stats.enrichedLeads / stats.totalLeads : 0,
          ),
        },
      ]
    : [];

  const readyToCallDetails = stats
    ? [
        { label: "Ready rate", value: formatPct(stats.readyToCallRate) },
        {
          label: "Needs research",
          value: String(stats.enrichedLeads - stats.readyToCall),
        },
      ]
    : [];

  const firecrawlDetails = stats
    ? [
        {
          label: "Remaining",
          value:
            firecrawlBalance?.remaining != null
              ? formatCredits(firecrawlBalance.remaining)
              : "—",
        },
        {
          label: "Used",
          value:
            firecrawlBalance?.used != null && firecrawlBalance.plan != null
              ? `${formatCredits(firecrawlBalance.used)} / ${formatCredits(firecrawlBalance.plan)}`
              : firecrawlBalance?.used != null
                ? formatCredits(firecrawlBalance.used)
                : "—",
        },
        {
          label: "Pipeline (mo)",
          value: formatCredits(stats.creditsThisMonth),
        },
      ]
    : [];

  const spendDetails =
    stats?.usdByProvider.map((row) => ({
      label: formatProvider(row.provider),
      value: formatUsd(row.usd),
    })) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader description="PALLARES sales CRM — Central Valley exterior cleaning." />

      {error ? (
        <Card className="glass">
          <CardContent className="py-8 text-center">
            <p className="text-sm font-medium text-destructive">{error}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Check your Supabase connection and sign-in.
            </p>
          </CardContent>
        </Card>
      ) : (
        <OverviewStatCards
          totalLeads={stats?.totalLeads ?? 0}
          enrichedLeads={stats?.enrichedLeads ?? 0}
          totalLeadsDetails={totalLeadsDetails}
          readyToCall={stats?.readyToCall ?? 0}
          readyToCallSub={`${formatPct(stats?.readyToCallRate ?? 0)} of enriched`}
          readyToCallDetails={readyToCallDetails}
          firecrawlValue={firecrawlBalance?.remaining ?? stats?.creditsThisMonth ?? 0}
          firecrawlSub={formatFirecrawlBalanceSub(
            firecrawlBalance,
            stats?.creditsThisMonth ?? 0,
          )}
          firecrawlDetails={firecrawlDetails}
          totalUsd={totalUsd}
          spendSub={formatOverviewSpendSub(stats?.usdByProvider ?? [])}
          spendDetails={spendDetails}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="glass hover-lift lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Activity className="size-4 text-muted-foreground" />
                Spend — last 14 days
              </CardTitle>
              <CardDescription>USD across all providers</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/costs">
                Details
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="h-44">
            <Suspense fallback={<Skeleton className="h-full w-full" />}>
              <SpendChartLazy data={costDays ?? []} />
            </Suspense>
          </CardContent>
        </Card>

        <Card className="glass hover-lift">
          <CardHeader>
            <CardTitle className="text-sm">Spend by provider</CardTitle>
            <CardDescription>This month</CardDescription>
          </CardHeader>
          <CardContent>
            {!stats || stats.usdByProvider.length === 0 ? (
              <p className="text-sm text-muted-foreground">No cost events yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {stats.usdByProvider.map((row) => {
                  const share = totalUsd > 0 ? row.usd / totalUsd : 0;
                  return (
                    <li key={row.provider} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">{formatProvider(row.provider)}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {formatUsd(row.usd)}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-secondary/80">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-primary to-[oklch(0.68_0.13_183)] transition-all duration-700"
                          style={{ width: `${Math.max(share * 100, 2)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="glass hover-lift">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm">Recent runs</CardTitle>
              <CardDescription>Latest run activity</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/runs">
                All runs
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {!runs || runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No runs yet.</p>
            ) : (
              runs.map((run) => (
                <div
                  key={run.run_id}
                  className="flex items-center gap-2.5 rounded-xl border border-border/50 bg-card/40 p-2.5 text-sm transition-colors hover:border-primary/30 hover:bg-accent/30"
                >
                  <RunStatusBadge status={run.status} />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {run.market_key ?? run.run_type}
                    {run.category_key ? (
                      <span className="text-muted-foreground"> / {run.category_key}</span>
                    ) : null}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {run.enriched_count} completed
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="glass hover-lift">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm">Recent requests</CardTitle>
              <CardDescription>Latest lead requests</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/requests">
                All requests
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {!requests || requests.length === 0 ? (
              <p className="text-sm text-muted-foreground">No requests yet.</p>
            ) : (
              requests.map((req) => (
                <div
                  key={req.request_id}
                  className="flex items-center gap-2.5 rounded-xl border border-border/50 bg-card/40 p-2.5 text-sm transition-colors hover:border-primary/30 hover:bg-accent/30"
                >
                  <RunStatusBadge status={req.status} />
                  <span className="min-w-0 flex-1 truncate">{req.raw_prompt}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {req.leads_delivered} delivered
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

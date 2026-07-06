"use client";

import Link from "next/link";
import { ArrowRight, Coins, Database, PhoneCall, Sparkles } from "lucide-react";
import ASCIIAnimation from "@/components/console/ascii-animation";
import { SectionHeading } from "@/components/console/section-heading";
import { SectionReveal } from "@/components/console/section-reveal";
import { TypedText } from "@/components/console/typed-text";
import { AnimatedNumber } from "@/components/animated";
import { RunStatusBadge } from "@/components/badges";
import { OverviewActions } from "@/components/overview/overview-actions";
import { SpendChartLazy } from "@/components/overview/spend-chart-lazy";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CostDayRow, RequestRow, RunRow } from "@/lib/types";
import { formatPct, formatUsd } from "@/lib/utils";

type CommandCenterProps = {
  stats: {
    totalLeads: number;
    readyToCall: number;
    readyToCallRate: number;
    creditsThisMonth: number;
    usdThisWeek: number;
  } | null;
  credits: {
    firecrawlRemaining: number;
    aiGatewayBalance: number | null;
  } | null;
  runs: RunRow[];
  requests: RequestRow[];
  costDays: CostDayRow[];
  error: string;
};

export function CommandCenterClient({
  stats,
  credits,
  runs,
  requests,
  costDays,
  error,
}: CommandCenterProps) {
  const activeRuns = runs.filter((r) => r.status === "running");

  return (
    <div className="space-y-10">
      <div className="relative overflow-hidden rounded-xl border border-border bg-card p-6 md:p-8">
        <div className="absolute right-0 top-0 h-48 w-48 opacity-15 md:h-64 md:w-64">
          <ASCIIAnimation
            frameFolder="planet"
            frameCount={200}
            quality="medium"
            lazy
            ariaLabel="ASCII planet animation"
          />
        </div>
        <div className="relative max-w-2xl space-y-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-primary">
            Pallares Leads
          </p>
          <h2 className="text-lg font-semibold normal-case tracking-tight md:text-xl">
            Dev Console
          </h2>
          <TypedText text="PALLARES LEADS — pipeline nominal" />
          <OverviewActions />
        </div>
      </div>

      {error ? (
        <Card className="glass">
          <CardContent className="py-8 text-center">
            <p className="text-sm font-medium text-destructive">{error}</p>
          </CardContent>
        </Card>
      ) : (
        <SectionReveal>
          <SectionHeading index="01" title="System" className="mb-4" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Card className="glass hover-lift">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em]">
                  <Coins className="size-3.5 text-warning" />
                  Firecrawl
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold tabular-nums">
                  <AnimatedNumber value={credits?.firecrawlRemaining ?? 0} />
                </p>
                <p className="mt-1 text-xs text-muted-foreground">credits remaining</p>
              </CardContent>
            </Card>
            <Card className="glass hover-lift">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em]">
                  <Sparkles className="size-3.5 text-primary" />
                  AI Gateway
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold tabular-nums">
                  {credits?.aiGatewayBalance != null ? (
                    <AnimatedNumber value={credits.aiGatewayBalance} format={formatUsd} />
                  ) : (
                    "—"
                  )}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">USD balance</p>
              </CardContent>
            </Card>
            <Card className="glass hover-lift">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em]">
                  <Database className="size-3.5" />
                  Leads
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold tabular-nums">
                  <AnimatedNumber value={stats?.totalLeads ?? 0} />
                </p>
                <p className="mt-1 text-xs text-muted-foreground">in database</p>
              </CardContent>
            </Card>
            <Card className="glass hover-lift">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em]">
                  <PhoneCall className="size-3.5 text-success" />
                  Callable
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold tabular-nums">
                  <AnimatedNumber value={stats?.readyToCall ?? 0} />
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatPct(stats?.readyToCallRate ?? 0)} verified
                </p>
              </CardContent>
            </Card>
            <Card className="glass hover-lift">
              <CardHeader className="pb-2">
                <CardTitle className="font-mono text-[10px] uppercase tracking-[0.12em]">
                  Spend (7d)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold tabular-nums">
                  <AnimatedNumber value={stats?.usdThisWeek ?? 0} format={formatUsd} />
                </p>
                <p className="mt-1 text-xs text-muted-foreground">all providers</p>
              </CardContent>
            </Card>
          </div>
        </SectionReveal>
      )}

      <SectionReveal>
        <SectionHeading index="02" title="Active runs" className="mb-4" />
        <Card className="glass">
          <CardContent className="space-y-2 py-4">
            {activeRuns.length === 0 ? (
              <p className="py-4 text-center font-mono text-xs text-muted-foreground">
                No active runs — launch from Campaigns or Runs.
              </p>
            ) : (
              activeRuns.map((run) => (
                <Link
                  key={run.run_id}
                  href={`/runs/${encodeURIComponent(run.run_id)}`}
                  className="flex items-center gap-3 rounded-lg border border-border/50 px-3 py-2.5 transition-colors hover:border-primary/30 hover:bg-accent/20"
                >
                  <RunStatusBadge status={run.status} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {run.market_key ?? run.run_type}
                    {run.category_key ? (
                      <span className="text-muted-foreground"> / {run.category_key}</span>
                    ) : null}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {run.enriched_count} done
                  </span>
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </SectionReveal>

      <SectionReveal>
        <SectionHeading index="03" title="Recent activity" className="mb-4" />
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="glass hover-lift lg:col-span-2">
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle className="font-mono text-[10px] uppercase tracking-[0.12em]">
                  Spend — 14 days
                </CardTitle>
                <CardDescription>USD across providers</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link href="/costs">
                  Details
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="h-44 min-h-44">
              <div className="h-full min-h-0 w-full min-w-0">
                <SpendChartLazy data={costDays} />
              </div>
            </CardContent>
          </Card>
          <Card className="glass hover-lift">
            <CardHeader>
              <CardTitle className="font-mono text-[10px] uppercase tracking-[0.12em]">
                Quick links
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button asChild variant="outline" size="sm" className="w-full justify-start">
                <Link href="/campaigns">Campaign Control</Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="w-full justify-start">
                <Link href="/data">Lead Data Explorer</Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="w-full justify-start">
                <Link href="/settings">Settings & Config</Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card className="glass hover-lift">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="font-mono text-[10px] uppercase tracking-[0.12em]">
                Recent runs
              </CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link href="/runs">All runs</Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {runs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No runs yet.</p>
              ) : (
                runs.slice(0, 5).map((run) => (
                  <Link
                    key={run.run_id}
                    href={`/runs/${encodeURIComponent(run.run_id)}`}
                    className="flex items-center gap-2 rounded-lg border border-border/50 px-2.5 py-2 text-sm hover:border-primary/30"
                  >
                    <RunStatusBadge status={run.status} />
                    <span className="min-w-0 flex-1 truncate">
                      {run.market_key ?? run.run_type}
                    </span>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
          <Card className="glass hover-lift">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="font-mono text-[10px] uppercase tracking-[0.12em]">
                Recent requests
              </CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link href="/requests">All requests</Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {requests.length === 0 ? (
                <p className="text-sm text-muted-foreground">No requests yet.</p>
              ) : (
                requests.slice(0, 5).map((req) => (
                  <div
                    key={req.request_id}
                    className="flex items-center gap-2 rounded-lg border border-border/50 px-2.5 py-2 text-sm"
                  >
                    <RunStatusBadge status={req.status} />
                    <span className="min-w-0 flex-1 truncate">{req.raw_prompt}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </SectionReveal>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Coins,
  DollarSign,
  PhoneCall,
  Users,
} from "lucide-react";
import { Area, AreaChart, ChartContainer } from "@/components/ui/chart";
import { PageHeader } from "@/components/page-header";
import { RunStatusBadge } from "@/components/badges";
import { Stagger, StaggerItem } from "@/components/animated";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  formatCredits,
  formatFirecrawlBalanceSub,
  formatOverviewSpendSub,
  formatPct,
  formatProvider,
  formatUsd,
} from "@/lib/utils";
import type { CostDayRow, OverviewStats, RequestRow, RunRow } from "@/lib/types";

export default function OverviewPage() {
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [costDays, setCostDays] = useState<CostDayRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/overview")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setStats(data);
      })
      .catch((e) => setError(String(e)));
    fetch("/api/runs")
      .then((r) => r.json())
      .then((data) => {
        setRuns((data.runs ?? []).slice(0, 5));
      });
    fetch("/api/requests")
      .then((r) => r.json())
      .then((data) => setRequests((data.requests ?? []).slice(0, 5)));
    fetch("/api/costs?days=14")
      .then((r) => r.json())
      .then((data) => setCostDays(data.byDay ?? []));
  }, []);

  const totalUsd = stats?.usdByProvider.reduce((s, p) => s + p.usd, 0) ?? 0;
  const firecrawlBalance = stats?.balances.find((b) => b.provider === "firecrawl");

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
        <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StaggerItem>
            <StatCard
              label="Total leads"
              value={stats?.totalLeads ?? 0}
              sub={`${stats?.enrichedLeads ?? 0} enriched`}
              icon={Users}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label="Ready to call"
              value={stats?.readyToCall ?? 0}
              sub={`${formatPct(stats?.readyToCallRate ?? 0)} of enriched`}
              icon={PhoneCall}
              tone="success"
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label="Firecrawl remaining"
              value={firecrawlBalance?.remaining ?? stats?.creditsThisMonth ?? 0}
              format={(n) => formatCredits(n)}
              sub={formatFirecrawlBalanceSub(
                firecrawlBalance,
                stats?.creditsThisMonth ?? 0,
              )}
              icon={Coins}
              tone="warning"
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label="Pipeline spend (month)"
              value={totalUsd}
              format={(n) => formatUsd(n)}
              sub={formatOverviewSpendSub(stats?.usdByProvider ?? [])}
              icon={DollarSign}
            />
          </StaggerItem>
        </Stagger>
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
            {costDays.length === 0 ? (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No cost events yet.
              </p>
            ) : (
              <ChartContainer
                config={{ usd: { label: "USD", color: "var(--chart-1)" } }}
              >
                <AreaChart data={costDays} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="usdFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                      <stop offset="55%" stopColor="var(--chart-2)" stopOpacity={0.12} />
                      <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="usd"
                    stroke="var(--chart-1)"
                    strokeWidth={2.5}
                    fill="url(#usdFill)"
                    animationDuration={900}
                  />
                </AreaChart>
              </ChartContainer>
            )}
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
            {runs.length === 0 ? (
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
            {requests.length === 0 ? (
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

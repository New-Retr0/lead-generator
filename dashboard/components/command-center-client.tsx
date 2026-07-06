"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Coins, Database, DollarSign, PhoneCall, Sparkles } from "lucide-react";
import ASCIIAnimation from "@/components/console/ascii-animation";
import { SectionHeading } from "@/components/console/section-heading";
import { SectionReveal } from "@/components/console/section-reveal";
import { TypedText } from "@/components/console/typed-text";
import { RunStatusBadge } from "@/components/badges";
import { OverviewActions } from "@/components/overview/overview-actions";
import { SpendChartLazy } from "@/components/overview/spend-chart-lazy";
import {
  formatCreditBalance,
  StatDetailDialog,
  type ProviderSpendRow,
} from "@/components/overview/stat-detail-dialog";
import { useSpendProviderSummary } from "@/components/campaigns/estimate-breakdown";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CostDayRow, RequestRow, RunRow } from "@/lib/types";
import { formatCredits, formatPct, formatUsd } from "@/lib/utils";

type StatDialog = "firecrawl" | "gateway" | "leads" | "callable" | "spend" | null;

type CommandCenterProps = {
  stats: {
    totalLeads: number;
    readyToCall: number;
    readyToCallRate: number;
    creditsThisMonth: number;
    usdThisWeek: number;
    enrichedLeads: number;
    aiGatewayUsdThisMonth: number;
  } | null;
  credits: {
    firecrawlRemaining: number;
    aiGatewayBalance: number | null;
    firecrawlUsed: number | null;
    firecrawlPlan: number | null;
    firecrawlBillingEnd: string | null;
    firecrawlSnapshotAt: string | null;
    aiGatewayUsed: number | null;
  } | null;
  runs: RunRow[];
  requests: RequestRow[];
  costDays: CostDayRow[];
  usdByProvider7d: { provider: string; usd: number }[];
  usdByProviderMonth: { provider: string; usd: number }[];
  error: string;
};

export function CommandCenterClient({
  stats,
  credits,
  runs,
  requests,
  costDays,
  usdByProvider7d,
  usdByProviderMonth,
  error,
}: CommandCenterProps) {
  const [dialog, setDialog] = useState<StatDialog>(null);
  const activeRuns = runs.filter((r) => r.status === "running");
  const spendSubtitle = useSpendProviderSummary(usdByProvider7d);

  const providerSpendRows: ProviderSpendRow[] = usdByProvider7d.map((row) => ({
    provider: row.provider,
    usd7d: row.usd,
    usdMonth:
      usdByProviderMonth.find((m) => m.provider === row.provider)?.usd ??
      (row.provider === "ai_gateway" ? (stats?.aiGatewayUsdThisMonth ?? 0) : 0),
  }));

  return (
    <div className="space-y-10">
      <div className="relative overflow-hidden rounded-xl border border-border bg-card p-6 md:p-8">
        <div className="pointer-events-none absolute right-0 top-0 h-56 w-full max-w-md md:h-72 [mask-image:linear-gradient(to_left,black_40%,transparent_100%)]">
          <ASCIIAnimation
            frameFolder="cube"
            frameCount={134}
            quality="medium"
            fps={30}
            className="h-full w-full"
            gradient="linear-gradient(160deg, var(--foreground), var(--primary))"
            lazy
            ariaLabel="ASCII cube animation"
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
            <StatCard
              label="Firecrawl"
              value={credits?.firecrawlRemaining ?? 0}
              format={(n) => formatCredits(n)}
              sub={formatCreditBalance(
                credits?.firecrawlRemaining ?? null,
                credits?.firecrawlUsed ?? null,
                credits?.firecrawlPlan ?? null,
              )}
              icon={Coins}
              tone="warning"
              onClick={() => setDialog("firecrawl")}
            />
            <StatCard
              label="AI Gateway"
              value={credits?.aiGatewayBalance ?? 0}
              format={formatUsd}
              sub={`${formatUsd(stats?.aiGatewayUsdThisMonth ?? 0)} MTD`}
              icon={Sparkles}
              onClick={() => setDialog("gateway")}
            />
            <StatCard
              label="Leads"
              value={stats?.totalLeads ?? 0}
              sub={`${stats?.enrichedLeads ?? 0} enriched`}
              icon={Database}
              onClick={() => setDialog("leads")}
            />
            <StatCard
              label="Callable"
              value={stats?.readyToCall ?? 0}
              sub={`${formatPct(stats?.readyToCallRate ?? 0)} verified`}
              icon={PhoneCall}
              tone="success"
              onClick={() => setDialog("callable")}
            />
            <StatCard
              label="Spend (7d)"
              value={stats?.usdThisWeek ?? 0}
              format={formatUsd}
              sub={spendSubtitle}
              icon={DollarSign}
              onClick={() => setDialog("spend")}
            />
          </div>
        </SectionReveal>
      )}

      <StatDetailDialog
        open={dialog === "firecrawl"}
        onOpenChange={(o) => setDialog(o ? "firecrawl" : null)}
        title="Firecrawl credits"
        value={credits?.firecrawlRemaining ?? 0}
        format={(n) => formatCredits(n)}
        rows={[
          {
            label: "Used this cycle",
            value:
              credits?.firecrawlUsed != null ? formatCredits(credits.firecrawlUsed) : "—",
          },
          {
            label: "Plan size",
            value: credits?.firecrawlPlan != null ? formatCredits(credits.firecrawlPlan) : "—",
          },
          {
            label: "Billing period end",
            value: credits?.firecrawlBillingEnd
              ? new Date(credits.firecrawlBillingEnd).toLocaleDateString()
              : "—",
          },
          {
            label: "Snapshot",
            value: credits?.firecrawlSnapshotAt
              ? new Date(credits.firecrawlSnapshotAt).toLocaleString()
              : "—",
          },
        ]}
      />
      <StatDetailDialog
        open={dialog === "gateway"}
        onOpenChange={(o) => setDialog(o ? "gateway" : null)}
        title="AI Gateway"
        value={credits?.aiGatewayBalance ?? 0}
        format={formatUsd}
        rows={[
          {
            label: "Month-to-date spend",
            value: formatUsd(stats?.aiGatewayUsdThisMonth ?? 0),
          },
          {
            label: "Pipeline credits (Firecrawl MTD)",
            value: formatCredits(stats?.creditsThisMonth ?? 0),
          },
        ]}
      />
      <StatDetailDialog
        open={dialog === "leads"}
        onOpenChange={(o) => setDialog(o ? "leads" : null)}
        title="Lead database"
        value={stats?.totalLeads ?? 0}
        rows={[
          { label: "Enriched", value: String(stats?.enrichedLeads ?? 0) },
          {
            label: "Not yet enriched",
            value: String((stats?.totalLeads ?? 0) - (stats?.enrichedLeads ?? 0)),
          },
        ]}
      />
      <StatDetailDialog
        open={dialog === "callable"}
        onOpenChange={(o) => setDialog(o ? "callable" : null)}
        title="Callable leads"
        value={stats?.readyToCall ?? 0}
        description="Leads passing isReadyToCall — verified decision-maker phone on file."
        rows={[
          { label: "Verified rate", value: formatPct(stats?.readyToCallRate ?? 0) },
          { label: "Total leads", value: String(stats?.totalLeads ?? 0) },
        ]}
      />
      <StatDetailDialog
        open={dialog === "spend"}
        onOpenChange={(o) => setDialog(o ? "spend" : null)}
        title="Spend (7 days)"
        value={stats?.usdThisWeek ?? 0}
        format={formatUsd}
        providerRows={providerSpendRows}
      />

      <SectionReveal>
        <SectionHeading index="02" title="Active runs" className="mb-4" />
        <Card className="glass">
          <CardContent className="space-y-2 py-4">
            {activeRuns.length === 0 ? (
              <p className="py-4 text-center font-mono text-xs text-muted-foreground">
                No active runs — launch from Campaigns or Requests.
              </p>
            ) : (
              activeRuns.map((run) => (
                <Link
                  key={run.run_id}
                  href={`/runs/${encodeURIComponent(run.run_id)}`}
                  className="flex items-center gap-3 rounded-lg border border-border/50 px-3 py-2.5 transition-colors hover:border-primary/30 hover:bg-muted/50"
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
          <Card className="glass lg:col-span-2">
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
          <Card className="glass">
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
          <Card className="glass">
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
                    className="flex items-center gap-2 rounded-lg border border-border/50 px-2.5 py-2 text-sm hover:border-primary/30 hover:bg-muted/50"
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
          <Card className="glass">
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
                  <Link
                    key={req.request_id}
                    href="/requests"
                    className="flex items-center gap-2 rounded-lg border border-border/50 px-2.5 py-2 text-sm hover:border-primary/30 hover:bg-muted/50"
                  >
                    <RunStatusBadge status={req.status} />
                    <span className="min-w-0 flex-1 truncate">{req.raw_prompt}</span>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </SectionReveal>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Coins, Database, DollarSign, PhoneCall } from "lucide-react";
import ASCIIAnimation from "@/components/console/ascii-animation";
import { SectionHeading } from "@/components/console/section-heading";
import { SectionReveal } from "@/components/console/section-reveal";
import { TypedText } from "@/components/console/typed-text";
import { RunStatusBadge, StopReasonBadge } from "@/components/badges";
import { AttentionStrip, type AttentionItem } from "@/components/overview/attention-strip";
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

type StatDialog = "firecrawl" | "leads" | "callable" | "spend" | null;

type CommandCenterProps = {
  stats: {
    totalLeads: number;
    readyToCall: number;
    readyToCallRate: number;
    partialInventory: number;
    verifiedThisMonth: number;
    creditsThisMonth: number;
    creditsPerVerifiedDm: number | null;
    creditsPerVerifiedDmCaveat: string | null;
    usdPerVerifiedDm: number | null;
    minutesPerVerifiedDm: number | null;
    usdThisWeek: number;
    enrichedLeads: number;
  } | null;
  credits: {
    firecrawlRemaining: number;
    firecrawlUsed: number | null;
    firecrawlPlan: number | null;
    firecrawlPlanName: string | null;
    firecrawlBillingEnd: string | null;
    firecrawlSnapshotAt: string | null;
    firecrawlExtraCredits: number | null;
    firecrawlPlanConcurrency: number | null;
    firecrawlLive: boolean;
  } | null;
  runs: RunRow[];
  requests: RequestRow[];
  costDays: CostDayRow[];
  usdByProvider7d: { provider: string; usd: number }[];
  usdByProviderMonth: { provider: string; usd: number }[];
  attentionItems: AttentionItem[];
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
  attentionItems,
  error,
}: CommandCenterProps) {
  const [dialog, setDialog] = useState<StatDialog>(null);
  const activeRuns = runs.filter((r) => r.status === "running");
  const spendSubtitle = useSpendProviderSummary(usdByProvider7d);

  const providerSpendRows: ProviderSpendRow[] = usdByProvider7d.map((row) => ({
    provider: row.provider,
    usd7d: row.usd,
    usdMonth: usdByProviderMonth.find((m) => m.provider === row.provider)?.usd ?? 0,
  }));

  return (
    <div className="space-y-10">
      <div className="relative min-h-[12.5rem] overflow-hidden rounded-xl border border-border bg-card p-6 md:min-h-[14rem] md:p-8">
        <div className="pointer-events-none absolute inset-y-2 right-0 w-[min(48%,20rem)] md:inset-y-3 md:w-[min(42%,22rem)]">
          <ASCIIAnimation
            frameFolder="cube"
            frameCount={134}
            quality="medium"
            fps={30}
            className="h-full w-full [mask-image:linear-gradient(to_left,black_70%,transparent_100%)]"
            gradient="linear-gradient(160deg, var(--foreground), var(--primary))"
            lazy={false}
            ariaLabel="ASCII cube animation"
          />
        </div>
        <div className="relative z-10 max-w-xl space-y-3 pr-4 md:max-w-2xl md:pr-8">
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

      <SectionReveal>
        <div className="mb-6">
          <AttentionStrip items={attentionItems} />
        </div>
        {error ? (
          <Card className="panel mb-6">
            <CardContent className="py-8 text-center">
              <p className="text-sm font-medium text-destructive">{error}</p>
            </CardContent>
          </Card>
        ) : null}
        <SectionHeading index="01" title="System" className="mb-4" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Firecrawl"
            value={credits?.firecrawlRemaining ?? 0}
            format={(n) => formatCredits(n)}
            sub={[
              formatCreditBalance(
                credits?.firecrawlRemaining ?? null,
                credits?.firecrawlUsed ?? null,
                credits?.firecrawlPlan ?? null,
              ),
              credits?.firecrawlPlanName ? credits.firecrawlPlanName : null,
              credits?.firecrawlLive ? "live" : "cached",
            ]
              .filter(Boolean)
              .join(" · ")}
            icon={Coins}
            tone="warning"
            onClick={() => setDialog("firecrawl")}
          />
          <StatCard
            label="Leads"
            value={stats?.totalLeads ?? 0}
            sub={`${stats?.enrichedLeads ?? 0} researched`}
            icon={Database}
            onClick={() => setDialog("leads")}
          />
          <StatCard
            label="Verified DMs"
            value={stats?.readyToCall ?? 0}
            sub={`${formatPct(stats?.readyToCallRate ?? 0)} of researched`}
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

      <StatDetailDialog
        open={dialog === "firecrawl"}
        onOpenChange={(o) => setDialog(o ? "firecrawl" : null)}
        title="Firecrawl credits"
        value={credits?.firecrawlRemaining ?? 0}
        format={(n) => formatCredits(n)}
        description={
          credits?.firecrawlLive
            ? "Live from Firecrawl team credit-usage + queue-status (also written to credit_snapshots)."
            : "Cached credit_snapshots — set FIRECRAWL_API_KEY for live balance."
        }
        rows={[
          {
            label: "Plan",
            value: credits?.firecrawlPlanName ?? "—",
          },
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
            label: "Extra / recharge",
            value:
              credits?.firecrawlExtraCredits != null && credits.firecrawlExtraCredits > 0
                ? formatCredits(credits.firecrawlExtraCredits)
                : "—",
          },
          {
            label: "Plan concurrency",
            value:
              credits?.firecrawlPlanConcurrency != null
                ? String(credits.firecrawlPlanConcurrency)
                : "—",
          },
          {
            label: "Billing period end",
            value: credits?.firecrawlBillingEnd
              ? new Date(credits.firecrawlBillingEnd).toLocaleDateString()
              : "—",
          },
          {
            label: "Fetched",
            value: credits?.firecrawlSnapshotAt
              ? new Date(credits.firecrawlSnapshotAt).toLocaleString()
              : "—",
          },
        ]}
      />
      <StatDetailDialog
        open={dialog === "leads"}
        onOpenChange={(o) => setDialog(o ? "leads" : null)}
        title="Lead database"
        value={stats?.totalLeads ?? 0}
        rows={[
          { label: "Researched", value: String(stats?.enrichedLeads ?? 0) },
          {
            label: "Discovered only",
            value: String((stats?.totalLeads ?? 0) - (stats?.enrichedLeads ?? 0)),
          },
        ]}
      />
      <StatDetailDialog
        open={dialog === "callable"}
        onOpenChange={(o) => setDialog(o ? "callable" : null)}
        title="Verified decision-makers"
        value={stats?.readyToCall ?? 0}
        description="One grounded name, decision-making role, and local callable phone from the same contact. Credits/DM prefers Firecrawl units attributed to verified-DM place_ids this month."
        rows={[
          { label: "Verified DM rate", value: formatPct(stats?.readyToCallRate ?? 0) },
          { label: "Verified this month", value: String(stats?.verifiedThisMonth ?? 0) },
          { label: "Partial inventory", value: String(stats?.partialInventory ?? 0) },
          {
            label: "Credits / verified DM",
            value:
              stats?.creditsPerVerifiedDm != null
                ? formatCredits(stats.creditsPerVerifiedDm)
                : "—",
          },
          ...(stats?.creditsPerVerifiedDmCaveat
            ? [{ label: "Credits caveat", value: stats.creditsPerVerifiedDmCaveat }]
            : []),
          {
            label: "USD / verified DM",
            value:
              stats?.usdPerVerifiedDm != null ? formatUsd(stats.usdPerVerifiedDm) : "—",
          },
          {
            label: "Time / verified DM",
            value:
              stats?.minutesPerVerifiedDm != null
                ? `${stats.minutesPerVerifiedDm.toFixed(1)} min`
                : "—",
          },
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
        <SectionHeading index="02" title="Cells in flight" className="mb-4" />
        <Card className="panel">
          <CardContent className="space-y-2 py-4">
            {activeRuns.length === 0 ? (
              <p className="py-4 text-center font-mono text-xs text-muted-foreground">
                No market cells running — launch from Launch.
              </p>
            ) : (
              activeRuns.map((run) => (
                <Link
                  key={run.run_id}
                  href={
                    run.job_id
                      ? `/runs?job=${encodeURIComponent(run.job_id)}`
                      : `/runs/${encodeURIComponent(run.run_id)}`
                  }
                  className="flex items-center gap-3 rounded-lg border border-border/50 px-3 py-2.5 transition-colors hover:border-primary/30 hover:bg-muted/50"
                >
                  <RunStatusBadge status={run.status} />
                  <StopReasonBadge
                    reason={run.stop_reason}
                    detail={run.stop_detail}
                    status={run.status}
                    discoveredCount={run.discovered_count}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {run.campaign_key ? (
                      <span className="text-muted-foreground">{run.campaign_key} · </span>
                    ) : null}
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
          <Card className="panel lg:col-span-2">
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
          <Card className="panel">
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
          <Card className="panel">
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
                    <StopReasonBadge
                      reason={run.stop_reason}
                      detail={run.stop_detail}
                      status={run.status}
                      discoveredCount={run.discovered_count}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {run.market_key ?? run.run_type}
                    </span>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
          <Card className="panel">
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

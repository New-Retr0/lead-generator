"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Coins,
  Database,
  DollarSign,
  FolderCog,
  PhoneCall,
  Rocket,
  Table2,
} from "lucide-react";
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
import { Card, CardContent } from "@/components/ui/card";
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
      <div className="relative min-h-[13.5rem] overflow-hidden rounded-2xl border border-border/70 bg-card p-6 md:min-h-[15rem] md:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_85%_20%,color-mix(in_oklab,var(--primary)_14%,transparent),transparent_55%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/45 to-transparent"
        />
        <div className="pointer-events-none absolute inset-y-3 right-2 flex w-[min(46%,19rem)] items-stretch md:inset-y-4 md:right-3 md:w-[min(40%,21rem)]">
          <ASCIIAnimation
            frameFolder="cube"
            frameCount={134}
            quality="low"
            fps={30}
            className="h-full min-h-[11rem] w-full opacity-90 [mask-image:linear-gradient(to_left,black_65%,transparent_100%)]"
            gradient="linear-gradient(160deg, var(--foreground), var(--primary))"
            lazy={false}
            ariaLabel="ASCII cube animation"
          />
        </div>
        <div className="relative z-10 max-w-xl space-y-3 pr-4 md:max-w-2xl md:pr-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-primary">
            Pallares Leads
          </p>
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
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
            sub={`${stats?.enrichedLeads ?? 0} worked`}
            icon={Database}
            onClick={() => setDialog("leads")}
          />
          <StatCard
            label="Verified"
            value={stats?.readyToCall ?? 0}
            sub={`${formatPct(stats?.readyToCallRate ?? 0)} of worked`}
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
              ? new Date(credits.firecrawlBillingEnd).toLocaleDateString("en-US")
              : "—",
          },
          {
            label: "Fetched",
            value: credits?.firecrawlSnapshotAt
              ? new Date(credits.firecrawlSnapshotAt).toLocaleString("en-US")
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
          { label: "Worked leads", value: String(stats?.enrichedLeads ?? 0) },
          {
            label: "Discovered only",
            value: String((stats?.totalLeads ?? 0) - (stats?.enrichedLeads ?? 0)),
          },
        ]}
      />
      <StatDetailDialog
        open={dialog === "callable"}
        onOpenChange={(o) => setDialog(o ? "callable" : null)}
        title="Verified leads"
        value={stats?.readyToCall ?? 0}
        description="Named decision-maker + grounded local phone. Unverified leads can still be tried. Credits/lead prefers Firecrawl units attributed to verified place_ids this month."
        rows={[
          { label: "Verified rate", value: formatPct(stats?.readyToCallRate ?? 0) },
          { label: "Verified this month", value: String(stats?.verifiedThisMonth ?? 0) },
          { label: "Unverified (phone)", value: String(stats?.partialInventory ?? 0) },
          {
            label: "Credits / verified",
            value:
              stats?.creditsPerVerifiedDm != null
                ? formatCredits(stats.creditsPerVerifiedDm)
                : "—",
          },
          ...(stats?.creditsPerVerifiedDmCaveat
            ? [{ label: "Credits caveat", value: stats.creditsPerVerifiedDmCaveat }]
            : []),
          {
            label: "USD / verified",
            value:
              stats?.usdPerVerifiedDm != null ? formatUsd(stats.usdPerVerifiedDm) : "—",
          },
          {
            label: "Time / verified",
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
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.75fr)]">
          <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_1px_0_color-mix(in_oklab,var(--foreground)_4%,transparent)]">
            <div className="flex items-start justify-between gap-3 border-b border-border/40 bg-muted/15 px-5 py-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Spend · 14 days
                </p>
                <p className="mt-1 text-sm text-muted-foreground">USD across providers</p>
              </div>
              <Button asChild variant="ghost" size="sm" className="shrink-0 text-muted-foreground">
                <Link href="/costs">
                  Details
                  <ArrowUpRight className="size-3.5" />
                </Link>
              </Button>
            </div>
            <div className="relative h-48 min-h-48 px-3 py-3 md:px-4">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-3 rounded-xl bg-[linear-gradient(to_bottom,transparent_0%,color-mix(in_oklab,var(--muted)_35%,transparent)_100%)]"
              />
              <div className="relative h-full">
                <SpendChartLazy data={costDays} />
              </div>
            </div>
          </section>

          <nav className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_1px_0_color-mix(in_oklab,var(--foreground)_4%,transparent)]">
            <div className="border-b border-border/40 bg-muted/15 px-5 py-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Jump to
              </p>
            </div>
            <div className="flex flex-col gap-1 p-2">
              {(
                [
                  { href: "/campaigns", label: "Campaign Control", icon: Rocket },
                  { href: "/data", label: "Lead Data Explorer", icon: Table2 },
                  { href: "/settings", label: "Settings & Config", icon: FolderCog },
                ] as const
              ).map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition-colors hover:bg-accent/70"
                >
                  <span className="flex size-8 items-center justify-center rounded-lg border border-border/60 bg-background text-muted-foreground transition-colors group-hover:border-primary/35 group-hover:text-primary">
                    <item.icon className="size-3.5" />
                  </span>
                  <span className="flex-1 font-medium tracking-tight">{item.label}</span>
                  <ArrowUpRight className="size-3.5 text-muted-foreground/40 transition-colors group-hover:text-primary" />
                </Link>
              ))}
            </div>
          </nav>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_1px_0_color-mix(in_oklab,var(--foreground)_4%,transparent)]">
            <div className="flex items-center justify-between gap-3 border-b border-border/40 bg-muted/15 px-5 py-3.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Recent runs
              </p>
              <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
                <Link href="/runs">
                  All runs
                  <ArrowUpRight className="size-3.5" />
                </Link>
              </Button>
            </div>
            <div className="divide-y divide-border/35">
              {runs.length === 0 ? (
                <p className="px-5 py-8 text-sm text-muted-foreground">No runs yet.</p>
              ) : (
                runs.slice(0, 5).map((run) => (
                  <Link
                    key={run.run_id}
                    href={`/runs/${encodeURIComponent(run.run_id)}`}
                    className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-accent/45"
                  >
                    <RunStatusBadge status={run.status} />
                    <StopReasonBadge
                      reason={run.stop_reason}
                      detail={run.stop_detail}
                      status={run.status}
                      discoveredCount={run.discovered_count}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-sm tracking-tight">
                      {run.market_key ?? run.run_type}
                    </span>
                    <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/35" />
                  </Link>
                ))
              )}
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_1px_0_color-mix(in_oklab,var(--foreground)_4%,transparent)]">
            <div className="flex items-center justify-between gap-3 border-b border-border/40 bg-muted/15 px-5 py-3.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Recent requests
              </p>
              <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
                <Link href="/requests">
                  All requests
                  <ArrowUpRight className="size-3.5" />
                </Link>
              </Button>
            </div>
            <div className="divide-y divide-border/35">
              {requests.length === 0 ? (
                <p className="px-5 py-8 text-sm text-muted-foreground">No requests yet.</p>
              ) : (
                requests.slice(0, 5).map((req) => (
                  <Link
                    key={req.request_id}
                    href="/requests"
                    className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-accent/50"
                  >
                    <RunStatusBadge status={req.status} />
                    <span className="min-w-0 flex-1 truncate text-sm">{req.raw_prompt}</span>
                    <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/40" />
                  </Link>
                ))
              )}
            </div>
          </section>
        </div>
      </SectionReveal>
    </div>
  );
}

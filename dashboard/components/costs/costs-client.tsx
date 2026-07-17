"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { AlertTriangle, Bot, Coins, DollarSign, RotateCw, Sparkles, TrendingUp } from "lucide-react";
import { Globe } from "lucide-react";
import ASCIIAnimation from "@/components/console/ascii-animation";
import { AnimatedNumber } from "@/components/animated";
import { providerLabel } from "@/components/campaigns/estimate-breakdown";
import { SectionHeading } from "@/components/console/section-heading";
import { Stagger, StaggerItem } from "@/components/animated";
import { StatCard } from "@/components/stat-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CostSeries } from "@/lib/types";
import { buildCostBudget } from "@/lib/cost-budget";
import {
  balanceLabel,
  formatCostUnits,
  formatCredits,
  formatProvider,
  formatUsd,
  formatUsdCompact,
} from "@/lib/utils";

const FIRECRAWL_CREDIT_REFERENCE = [
  { operation: "Scrape / crawl", cost: "1 credit per page" },
  { operation: "Map", cost: "1 credit" },
  { operation: "Search", cost: "2 credits per 10 results" },
  { operation: "JSON mode", cost: "+4 credits per page" },
  { operation: "PDF", cost: "+1 credit per page" },
  {
    operation: "Standard public plan",
    cost: "100,000 cr / $83 mo billed yearly -> $0.00083 per credit",
  },
  {
    operation: "Growth / Scale",
    cost: "500,000 cr / $333 mo, 1,000,000 cr / $599 mo",
  },
] as const;

const CostsUsdChart = dynamic(
  () => import("@/components/costs/costs-usd-chart").then((m) => m.CostsUsdChart),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> },
);

const CostsCreditsChart = dynamic(
  () => import("@/components/costs/costs-credits-chart").then((m) => m.CostsCreditsChart),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> },
);

const PROVIDER_CHIP_COLORS: Record<string, string> = {
  firecrawl: "var(--chart-1)",
  browser_use: "var(--chart-3)",
  ai_gateway: "var(--chart-4)",
  google_places: "var(--chart-5)",
};

const RANGES = [7, 30, 90] as const;

function balanceFor(series: CostSeries | null, provider: string) {
  return series?.balances.find((b) => b.provider === provider) ?? null;
}

export function CostsClient({
  initialDays,
  initialData,
}: {
  initialDays: number;
  initialData: CostSeries;
}) {
  const [days, setDays] = useState(initialDays);
  const [rangeData, setRangeData] = useState<{ days: number; data: CostSeries } | null>(
    null,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [liveCredits, setLiveCredits] = useState<{
    firecrawl: {
      remaining: number | null;
      plan: number | null;
      used: number | null;
      planName?: string | null;
      creditUsd?: number | null;
      billingPeriodStart: string | null;
      billingPeriodEnd: string | null;
      live: boolean;
    };
    aiGateway: { balanceUsd: number | null; live: boolean };
  } | null>(null);

  useEffect(() => {
    void fetch("/api/credits")
      .then((r) => r.json())
      .then((body) => setLiveCredits(body));
  }, []);

  const data = rangeData?.days === days ? rangeData.data : initialData;

  useEffect(() => {
    if (days === initialDays) return;
    const controller = new AbortController();
    fetch(`/api/costs?days=${days}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((body) => {
        setRangeData({ days, data: body as CostSeries });
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("Failed to load costs", err);
      });
    return () => controller.abort();
  }, [days, initialDays]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const [costBody, credBody] = await Promise.all([
        fetch(`/api/costs?days=${days}`).then((r) => r.json()),
        fetch("/api/credits").then((r) => r.json()),
      ]);
      setRangeData({ days, data: costBody as CostSeries });
      setLiveCredits(credBody);
    } finally {
      setRefreshing(false);
    }
  }, [days]);

  const totals = useMemo(() => {
    if (!data) {
      return {
        usd: 0,
        firecrawlCredits: 0,
        browserUseUsd: 0,
        aiGatewayUsd: 0,
      };
    }
    const usd = data.byDay.reduce((s, d) => s + d.usd, 0);
    const firecrawlCredits = data.byDay.reduce((s, d) => s + d.firecrawlCredits, 0);
    const browserUseUsd = data.byDay.reduce((s, d) => s + d.browserUseUsd, 0);
    const aiGatewayUsd = data.byDay.reduce((s, d) => s + d.aiGatewayUsd, 0);
    return { usd, firecrawlCredits, browserUseUsd, aiGatewayUsd };
  }, [data]);

  const firecrawlBalance = balanceFor(data, "firecrawl");
  const browserUseBalance = balanceFor(data, "browser_use");

  const budget = useMemo(() => {
    if (!data) return null;
    const liveFc = liveCredits?.firecrawl;
    const balanceInput =
      liveFc?.plan != null
        ? {
            remaining: liveFc.remaining,
            plan: liveFc.plan,
            used: liveFc.used,
            planName: liveFc.planName,
            creditUsd: liveFc.creditUsd,
            billingPeriodEnd: liveFc.billingPeriodEnd,
          }
        : (firecrawlBalance ?? undefined);
    return buildCostBudget(balanceInput, data.byDay);
  }, [data, liveCredits, firecrawlBalance]);

  const liveFirecrawlSub = useMemo(() => {
    const fc = liveCredits?.firecrawl;
    if (!fc || fc.remaining == null) return "Configure FIRECRAWL_API_KEY for live balance";
    const parts = [`${formatCredits(fc.remaining)} remaining`];
    if (fc.used != null && fc.plan != null) {
      parts.push(`${formatCredits(fc.used)} / ${formatCredits(fc.plan)} used`);
    } else if (fc.used != null) {
      parts.push(`${formatCredits(fc.used)} used`);
    }
    if (fc.billingPeriodEnd) {
      parts.push(`refresh ${new Date(fc.billingPeriodEnd).toLocaleDateString()}`);
    }
    return `${parts.join(" · ")} · api.firecrawl.dev`;
  }, [liveCredits]);

  const providerChips = useMemo(() => {
    if (!data?.byProvider.length) return [];
    return data.byProvider.map((row) => ({
      provider: row.provider,
      usd: row.usd,
      color: PROVIDER_CHIP_COLORS[row.provider] ?? "var(--muted-foreground)",
    }));
  }, [data]);

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-xl border border-border">
        <ASCIIAnimation
          frameFolder="wave"
          frameCount={300}
          quality="medium"
          fps={30}
          className="absolute inset-x-0 bottom-0 h-[8.5rem] w-full [mask-image:linear-gradient(to_top,black_50%,transparent_100%)]"
          gradient="linear-gradient(160deg, var(--foreground), var(--primary))"
          lazy
          ariaLabel="Wave animation"
        />
        <div className="relative flex flex-col gap-4 p-6 md:flex-row md:items-end md:justify-between">
          <div>
            <SectionHeading index="01" title="Costs & Credits" className="mb-2" />
            <p className="text-4xl font-bold tabular-nums tracking-tight">
              <AnimatedNumber value={totals.usd} format={formatUsd} />
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Pipeline spend — last {days} days · all providers
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <Tabs value={String(days)} onValueChange={(v) => setDays(Number(v))}>
                    <TabsList>
                      {RANGES.map((r) => (
                        <TabsTrigger key={r} value={String(r)}>
                          {r}d
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                </div>
              </TooltipTrigger>
              <TooltipContent>Spend window.</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={refreshing}
                  onClick={() => void refreshAll()}
                >
                  <RotateCw className={refreshing ? "size-4 animate-spin" : "size-4"} />
                  Refresh
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reload live balances.</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      {providerChips.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {providerChips.map((chip) => (
            <Badge key={chip.provider} variant="outline" className="gap-2 font-mono text-[10px]">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: chip.color }}
              />
              {providerLabel(chip.provider)} {formatUsd(chip.usd)}
            </Badge>
          ))}
        </div>
      ) : null}

      {liveCredits ? (
        <div className="flex flex-wrap gap-3 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
          <Badge variant="outline">
            Firecrawl account (live):{" "}
            {liveCredits.firecrawl.remaining != null
              ? formatCredits(liveCredits.firecrawl.remaining)
              : "—"}
            {liveCredits.firecrawl.live ? "" : " · snapshot"}
          </Badge>
          {liveCredits.firecrawl.used != null ? (
            <Badge variant="outline">
              Used this cycle: {formatCredits(liveCredits.firecrawl.used)}
            </Badge>
          ) : null}
          <Badge variant="outline">
            AI Gateway live:{" "}
            {liveCredits.aiGateway.balanceUsd != null
              ? formatUsd(liveCredits.aiGateway.balanceUsd)
              : "—"}
          </Badge>
        </div>
      ) : null}

      <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StaggerItem className="h-full">
          <StatCard
            label={`Pipeline ledger (${days}d)`}
            value={totals.usd}
            format={(n) => formatUsdCompact(n)}
            sub="All providers — tracked per tool call"
            icon={DollarSign}
          />
        </StaggerItem>
        <StaggerItem className="h-full">
          <StatCard
            label={`Pipeline Firecrawl (${days}d)`}
            value={totals.firecrawlCredits}
            format={(n) => formatCredits(n)}
            sub="Credits from cost_events ledger"
            icon={Coins}
            tone="warning"
          />
        </StaggerItem>
        <StaggerItem className="h-full">
          <StatCard
            label={`Browser Use (${days}d)`}
            value={totals.browserUseUsd}
            format={(n) => formatUsdCompact(n)}
            sub={
              browserUseBalance?.remaining != null
                ? `${formatUsd(browserUseBalance.remaining)} remaining`
                : "Owner-chain portal lookups"
            }
            icon={Bot}
          />
        </StaggerItem>
        <StaggerItem className="h-full">
          <StatCard
            label={`AI Gateway (${days}d)`}
            value={totals.aiGatewayUsd}
            format={(n) => formatUsdCompact(n)}
            sub="Sales copy tokens"
            icon={Sparkles}
          />
        </StaggerItem>
      </Stagger>

      {budget ? (
        <Card className={`glass ${budget.projectedOverPlan ? "border-amber-500/50" : ""}`}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              Firecrawl account (live)
              {budget.percentOfPlanUsed != null && budget.percentOfPlanUsed >= 80 ? (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="size-3" />
                  {budget.percentOfPlanUsed.toFixed(0)}% used
                </Badge>
              ) : null}
            </CardTitle>
            <CardDescription>
              {budget.planName ? `${budget.planName} - ` : ""}
              {budget.planCredits != null
                ? `${formatCredits(budget.planCredits)} credits/mo`
                : "Plan size unknown"}
              {budget.billingPeriodEnd
                ? ` — refresh ${new Date(budget.billingPeriodEnd).toLocaleDateString()}`
                : ""}
              {" · from api.firecrawl.dev"}
            </CardDescription>
            {budget.remainingCredits != null && budget.remainingCredits > budget.planCredits ? (
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Balance includes extra/recharge credits beyond monthly plan.
              </p>
            ) : null}
            {liveFirecrawlSub ? (
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {liveFirecrawlSub}
              </p>
            ) : null}
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Used this cycle
                </p>
                <p className="mt-1 font-mono text-2xl font-bold tabular-nums">
                  {budget.usedThisCycle != null
                    ? formatCredits(budget.usedThisCycle)
                    : "—"}
                </p>
                {budget.percentOfPlanUsed != null ? (
                  <p className="text-xs text-muted-foreground">
                    {budget.percentOfPlanUsed.toFixed(1)}% of plan
                  </p>
                ) : null}
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Remaining
                </p>
                <p className="mt-1 font-mono text-2xl font-bold tabular-nums">
                  {budget.remainingCredits != null
                    ? formatCredits(budget.remainingCredits)
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  7-day avg / day
                </p>
                <p className="mt-1 font-mono text-2xl font-bold tabular-nums">
                  {formatCredits(budget.dailyAverageCredits ?? 0)}
                </p>
                <p className="text-xs text-muted-foreground">Pipeline ledger ÷ 7 calendar days</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Projected cycle end
                </p>
                <p className="mt-1 font-mono text-2xl font-bold tabular-nums">
                  {budget.billingPeriodEnd && budget.projectedCycleCredits != null
                    ? formatCredits(budget.projectedCycleCredits)
                    : "—"}
                </p>
                {budget.billingPeriodEnd && budget.projectedCycleCredits != null ? (
                  <p
                    className={
                      budget.projectedOverPlan
                        ? "text-xs font-medium text-amber-600 dark:text-amber-400"
                        : "text-xs text-muted-foreground"
                    }
                  >
                    {budget.projectedOverPlan ? "Over plan" : "Under plan"}
                  </p>
                ) : budget.billingPeriodEnd == null ? (
                  <p className="text-xs text-muted-foreground">Billing period end unknown</p>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {(data?.balances.length ?? 0) > 0 ? (
        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-sm">Provider balances</CardTitle>
            <CardDescription>
              Latest snapshot from pallares-leads doctor or lead runs
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {data?.balances.map((row) => (
                <div
                  key={row.provider}
                  className="flex items-center justify-between rounded-lg border bg-card px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium">{formatProvider(row.provider)}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.snapshotAt
                        ? `Snapshot ${row.snapshotAt.slice(0, 10)}`
                        : "No snapshot date"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold tabular-nums">
                      {row.remaining != null
                        ? row.provider === "browser_use"
                          ? formatUsd(row.remaining)
                          : `${row.remaining.toFixed(0)} ${balanceLabel(row.provider)}`
                        : "—"}
                    </p>
                    {row.used != null ? (
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {row.used.toFixed(0)} used
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-sm">USD per day by provider</CardTitle>
            <CardDescription>Stacked spend — Browser Use, AI Gateway, Places</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <CostsUsdChart data={data?.byDay ?? []} />
          </CardContent>
        </Card>

        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-sm">Firecrawl credits per day</CardTitle>
            <CardDescription>Firecrawl credits from single-pass lead runs</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <CostsCreditsChart data={data?.byDay ?? []} />
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="providers" className="space-y-4">
        <TabsList>
          <TabsTrigger value="providers">Providers</TabsTrigger>
          <TabsTrigger value="operations">Operations</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="models">Models</TabsTrigger>
          <TabsTrigger value="markets">Markets</TabsTrigger>
        </TabsList>

        <TabsContent value="providers">
        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-sm">By provider</CardTitle>
            <CardDescription>Unit-aware totals for the selected range</CardDescription>
          </CardHeader>
          <CardContent>
            {!data || data.byProvider.length === 0 ? (
              <p className="text-sm text-muted-foreground">No cost events in range.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="text-right">USD</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byProvider.map((row) => (
                    <TableRow key={row.provider}>
                      <TableCell className="font-medium">
                        {formatProvider(row.provider)}
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          · {row.count} calls
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatCostUnits(row.provider, row.units, row.unitType)}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatUsd(row.usd)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        </TabsContent>

        <TabsContent value="operations">
        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-sm">Top operations</CardTitle>
            <CardDescription>Per-stage breakdown including owner-chain stages</CardDescription>
          </CardHeader>
          <CardContent>
            {!data || data.byOperation.length === 0 ? (
              <p className="text-sm text-muted-foreground">No operations in range.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Operation</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">USD</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byOperation.map((row) => (
                    <TableRow key={`${row.provider}-${row.operation}`}>
                      <TableCell>
                        <span className="font-medium">{row.operation}</span>
                        <span className="text-xs text-muted-foreground">
                          {" "}
                          · {formatProvider(row.provider)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatUsd(row.usd)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        </TabsContent>

        <TabsContent value="runs">
        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-sm">By run</CardTitle>
            <CardDescription>Per-run spend — click a row for stage breakdown</CardDescription>
          </CardHeader>
          <CardContent>
            {!data || data.byRun.length === 0 ? (
              <p className="text-sm text-muted-foreground">No runs with costs in range.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Run</TableHead>
                      <TableHead className="text-right">Leads</TableHead>
                      <TableHead className="text-right">Credits</TableHead>
                      <TableHead className="text-right">USD</TableHead>
                      <TableHead className="text-right">$/lead</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byRun.map((row) => (
                      <TableRow key={row.runId} className="hover-lift hover:bg-muted/50">
                        <TableCell>
                          <Link
                            href={`/runs/${encodeURIComponent(row.runId)}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {row.marketKey ?? row.runType}
                            {row.categoryKey ? ` · ${row.categoryKey}` : ""}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {row.startedAt.slice(0, 16).replace("T", " ")}
                          </p>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.enrichedCount}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCredits(row.firecrawlCredits)}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {formatUsd(row.usd)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {row.usdPerEnrichedLead != null
                            ? formatUsd(row.usdPerEnrichedLead)
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
        </TabsContent>

        <TabsContent value="models">
        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-sm">By model / provider</CardTitle>
            <CardDescription>AI Gateway models vs Firecrawl vs Browser Use</CardDescription>
          </CardHeader>
          <CardContent>
            {!data || data.byModel.length === 0 ? (
              <p className="text-sm text-muted-foreground">No model-level costs yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Provider / model</TableHead>
                      <TableHead className="text-right">Calls</TableHead>
                      <TableHead className="text-right">Units</TableHead>
                      <TableHead className="text-right">USD</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byModel.map((row) => (
                      <TableRow key={`${row.provider}-${row.model}-${row.operation}`}>
                        <TableCell>
                          <span className="font-medium">{formatProvider(row.provider)}</span>
                          {row.model ? (
                            <span className="text-xs text-muted-foreground"> · {row.model}</span>
                          ) : null}
                          <p className="text-xs text-muted-foreground">{row.operation}</p>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{row.eventCount}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {formatCostUnits(row.provider, row.units, row.unitType)}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {formatUsd(row.usd)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
        </TabsContent>

        <TabsContent value="markets">
      <Card className="glass">
        <CardHeader>
          <CardTitle className="text-sm">By market / category</CardTitle>
          <CardDescription>Where spend is going — last 90 days rollup</CardDescription>
        </CardHeader>
        <CardContent>
          {!data || data.byMarket.length === 0 ? (
            <p className="text-sm text-muted-foreground">No market-level costs yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Market</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Runs</TableHead>
                    <TableHead className="text-right">Credits</TableHead>
                    <TableHead className="text-right">USD</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byMarket.map((row) => (
                    <TableRow key={`${row.marketKey}-${row.categoryKey}`}>
                      <TableCell className="font-medium">
                        <Link href="/data" className="text-primary hover:underline">
                          {row.marketKey ?? "—"}
                        </Link>
                      </TableCell>
                      <TableCell>{row.categoryKey ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.runCount}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCredits(row.firecrawlCredits)}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatUsd(row.usd)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
        </TabsContent>
      </Tabs>

      <Collapsible>
        <Card className="glass">
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer">
              <CardTitle className="font-mono text-sm">Firecrawl credit reference</CardTitle>
              <CardDescription>Per-operation costs from Firecrawl docs and public plan examples</CardDescription>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2">
            {FIRECRAWL_CREDIT_REFERENCE.map((row) => (
              <div
                key={row.operation}
                className="flex items-baseline justify-between gap-3 rounded-lg border bg-card/50 px-3 py-2 font-mono text-xs"
              >
                <span className="text-muted-foreground">{row.operation}</span>
                <span className="shrink-0 text-right tabular-nums">{row.cost}</span>
              </div>
            ))}
          </div>
        </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <Card className="glass border-dashed">
        <CardContent className="flex items-start gap-3 py-4 text-sm text-muted-foreground">
          <TrendingUp className="mt-0.5 size-4 shrink-0" />
          <p>
            Browser Use costs are recorded per portal task (SOS, recorder, parcel, LoopNet).
            Run <span className="font-medium text-foreground">pallares-leads doctor</span> (or{" "}
            <span className="font-medium text-foreground">Health check</span> on the overview page)
            to refresh Firecrawl and Browser Use balance snapshots without spending credits.
          </p>
          <Globe className="mt-0.5 size-4 shrink-0 opacity-0 sm:opacity-100" aria-hidden />
        </CardContent>
      </Card>
    </div>
  );
}

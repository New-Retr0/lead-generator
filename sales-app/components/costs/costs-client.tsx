"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Bot, Coins, DollarSign, Sparkles, TrendingUp } from "lucide-react";
import { Globe } from "lucide-react";
import { PageHeader } from "@/components/page-header";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CostSeries } from "@/lib/types";
import {
  balanceLabel,
  formatCostUnits,
  formatCredits,
  formatFirecrawlLiveBalance,
  formatProvider,
  formatUsd,
  formatUsdCompact,
} from "@/lib/utils";

const CostsUsdChart = dynamic(
  () => import("@/components/costs/costs-usd-chart").then((m) => m.CostsUsdChart),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> },
);

const CostsCreditsChart = dynamic(
  () => import("@/components/costs/costs-credits-chart").then((m) => m.CostsCreditsChart),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> },
);

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
  const [fetchedData, setFetchedData] = useState<CostSeries | null>(null);

  const data = days === initialDays ? initialData : (fetchedData ?? initialData);

  useEffect(() => {
    if (days === initialDays) return;
    fetch(`/api/costs?days=${days}`)
      .then((r) => r.json())
      .then(setFetchedData);
  }, [days, initialDays]);

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

  return (
    <div className="space-y-6">
      <PageHeader description="Spend across Firecrawl, Browser Use, AI Gateway, and Google Places — balances from the latest doctor/run snapshots.">
        <Tabs value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <TabsList>
            {RANGES.map((r) => (
              <TabsTrigger key={r} value={String(r)}>
                {r}d
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </PageHeader>

      <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StaggerItem className="h-full">
          <StatCard
            label={`Total spend (${days}d)`}
            value={totals.usd}
            format={(n) => formatUsdCompact(n)}
            icon={DollarSign}
          />
        </StaggerItem>
        <StaggerItem className="h-full">
          <StatCard
            label={`Pipeline Firecrawl (${days}d)`}
            value={totals.firecrawlCredits}
            format={(n) => formatCredits(n)}
            sub={formatFirecrawlLiveBalance(firecrawlBalance ?? undefined)}
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
        <Card className="glass hover-lift">
          <CardHeader>
            <CardTitle className="text-sm">USD per day by provider</CardTitle>
            <CardDescription>Stacked spend — Browser Use, AI Gateway, Places</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <CostsUsdChart data={data?.byDay ?? []} />
          </CardContent>
        </Card>

        <Card className="glass hover-lift">
          <CardHeader>
            <CardTitle className="text-sm">Firecrawl credits per day</CardTitle>
            <CardDescription>Firecrawl credits from single-pass lead runs</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <CostsCreditsChart data={data?.byDay ?? []} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
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
      </div>

      <Card className="glass border-dashed">
        <CardContent className="flex items-start gap-3 py-4 text-sm text-muted-foreground">
          <TrendingUp className="mt-0.5 size-4 shrink-0" />
          <p>
            Browser Use costs are recorded per portal task (SOS, recorder, parcel, LoopNet).
            Run <span className="font-medium text-foreground">Health check</span> on the overview
            page to refresh Firecrawl and Browser Use balance snapshots without spending credits.
          </p>
          <Globe className="mt-0.5 size-4 shrink-0 opacity-0 sm:opacity-100" aria-hidden />
        </CardContent>
      </Card>
    </div>
  );
}

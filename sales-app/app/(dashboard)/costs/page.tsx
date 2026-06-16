"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, Coins, DollarSign, Globe, Sparkles, TrendingUp } from "lucide-react";
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
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ChartContainer,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
} from "@/components/ui/chart";
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
} from "@/lib/utils";

const RANGES = [7, 30, 90] as const;

const PROVIDER_CHART_COLORS: Record<string, string> = {
  browser_use: "var(--chart-3)",
  ai_gateway: "var(--chart-4)",
  google_places: "var(--chart-5)",
};

function balanceFor(series: CostSeries | null, provider: string) {
  return series?.balances.find((b) => b.provider === provider) ?? null;
}

export default function CostsPage() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<CostSeries | null>(null);

  useEffect(() => {
    fetch(`/api/costs?days=${days}`)
      .then((r) => r.json())
      .then(setData);
  }, [days]);

  const totals = useMemo(() => {
    if (!data) {
      return {
        usd: 0,
        firecrawlCredits: 0,
        browserUseUsd: 0,
        aiGatewayUsd: 0,
        topProvider: "—",
      };
    }
    const usd = data.byDay.reduce((s, d) => s + d.usd, 0);
    const firecrawlCredits = data.byDay.reduce((s, d) => s + d.firecrawlCredits, 0);
    const browserUseUsd = data.byDay.reduce((s, d) => s + d.browserUseUsd, 0);
    const aiGatewayUsd = data.byDay.reduce((s, d) => s + d.aiGatewayUsd, 0);
    return {
      usd,
      firecrawlCredits,
      browserUseUsd,
      aiGatewayUsd,
      topProvider: data.byProvider[0]?.provider ?? "—",
    };
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
        <StaggerItem>
          <StatCard
            label={`Total spend (${days}d)`}
            value={totals.usd}
            format={(n) => formatUsd(n)}
            icon={DollarSign}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label={`Pipeline Firecrawl (${days}d)`}
            value={totals.firecrawlCredits}
            format={(n) => formatCredits(n)}
            sub={formatFirecrawlLiveBalance(firecrawlBalance ?? undefined)}
            icon={Coins}
            tone="warning"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label={`Browser Use (${days}d)`}
            value={totals.browserUseUsd}
            format={(n) => formatUsd(n)}
            sub={
              browserUseBalance?.remaining != null
                ? `${formatUsd(browserUseBalance.remaining)} remaining`
                : "Owner-chain portal lookups"
            }
            icon={Bot}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label={`AI Gateway (${days}d)`}
            value={totals.aiGatewayUsd}
            format={(n) => formatUsd(n)}
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
                      <p className="text-xs text-muted-foreground tabular-nums">
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
            <ChartContainer
              config={{
                browserUseUsd: { label: "Browser Use", color: PROVIDER_CHART_COLORS.browser_use },
                aiGatewayUsd: { label: "AI Gateway", color: PROVIDER_CHART_COLORS.ai_gateway },
                googlePlacesUsd: {
                  label: "Google Places",
                  color: PROVIDER_CHART_COLORS.google_places,
                },
              }}
            >
              <AreaChart data={data?.byDay ?? []}>
                <defs>
                  <linearGradient id="buFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="aiFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-4)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--chart-4)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gpFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-5)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--chart-5)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v) => formatUsd(Number(v))} />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="browserUseUsd"
                  stackId="usd"
                  stroke="var(--chart-3)"
                  fill="url(#buFill)"
                />
                <Area
                  type="monotone"
                  dataKey="aiGatewayUsd"
                  stackId="usd"
                  stroke="var(--chart-4)"
                  fill="url(#aiFill)"
                />
                <Area
                  type="monotone"
                  dataKey="googlePlacesUsd"
                  stackId="usd"
                  stroke="var(--chart-5)"
                  fill="url(#gpFill)"
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="glass hover-lift">
          <CardHeader>
            <CardTitle className="text-sm">Firecrawl credits per day</CardTitle>
            <CardDescription>Firecrawl credits from single-pass lead runs</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ChartContainer
              config={{ firecrawlCredits: { label: "Credits", color: "var(--chart-2)" } }}
            >
              <BarChart data={data?.byDay ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip />
                <Bar
                  dataKey="firecrawlCredits"
                  fill="var(--chart-2)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
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

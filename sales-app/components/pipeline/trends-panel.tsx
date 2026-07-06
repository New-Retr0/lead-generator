"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "@/components/ui/chart";
import { ChartContainer } from "@/components/ui/chart";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PipelineTrends } from "@/lib/types";
import { formatUsdCompact } from "@/lib/utils";
import { ChipSelect } from "@/components/chip-select";

const RANGES = [7, 30, 90] as const;

function deltaBadge(current: number, prior: number): { label: string; tone: "up" | "down" | "flat" } {
  if (prior === 0 && current === 0) return { label: "—", tone: "flat" };
  if (prior === 0) return { label: "+100%", tone: "up" };
  const pct = ((current - prior) / prior) * 100;
  if (Math.abs(pct) < 0.5) return { label: "±0%", tone: "flat" };
  return {
    label: `${pct > 0 ? "+" : ""}${pct.toFixed(0)}%`,
    tone: pct > 0 ? "up" : "down",
  };
}

function splitPeriod<T extends { day: string }>(rows: T[], days: number): { current: T[]; prior: T[] } {
  const sorted = [...rows].sort((a, b) => a.day.localeCompare(b.day));
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length < 4) {
    return { current: sorted, prior: [] };
  }
  return { current: sorted.slice(mid), prior: sorted.slice(0, mid) };
}

export function TrendsPanel({
  initialDays,
  initialData,
  filterOptions,
}: {
  initialDays: number;
  initialData: PipelineTrends;
  filterOptions: { markets: string[]; categories: string[] };
}) {
  const [days, setDays] = useState(initialDays);
  const [market, setMarket] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [data, setData] = useState(initialData);
  const [selectedStages, setSelectedStages] = useState<string[]>([]);

  useEffect(() => {
    const params = new URLSearchParams({ days: String(days) });
    if (market) params.set("market", market);
    if (category) params.set("category", category);
    fetch(`/api/pipeline/trends?${params}`)
      .then((r) => r.json())
      .then(setData);
  }, [days, market, category]);

  const stageOptions = useMemo(() => {
    const stages = new Set(data.stageTrends.map((r) => r.stage));
    return [...stages].sort();
  }, [data.stageTrends]);

  useEffect(() => {
    if (selectedStages.length === 0 && stageOptions.length > 0) {
      setSelectedStages(stageOptions.slice(0, 4));
    }
  }, [stageOptions, selectedStages.length]);

  const efficiencyChart = useMemo(() => {
    const byDay = new Map<
      string,
      { day: string; usdPerLead: number | null; runs: number; leads: number }
    >();
    for (const row of data.runEfficiency) {
      byDay.set(row.day, {
        day: row.day.slice(5),
        usdPerLead: row.usdPerEnrichedLead,
        runs: row.runCount,
        leads: row.leadsEnriched,
      });
    }
    return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  }, [data.runEfficiency]);

  const stageLines = useMemo(() => {
    const days = [...new Set(data.stageTrends.map((r) => r.day))].sort();
    return days.map((day) => {
      const point: Record<string, string | number | null> = { day: day.slice(5) };
      for (const stage of selectedStages) {
        const row = data.stageTrends.find((r) => r.day === day && r.stage === stage);
        point[stage] = row?.avgDurationMs ?? null;
        point[`${stage}_p95`] = row?.p95DurationMs ?? null;
      }
      return point;
    });
  }, [data.stageTrends, selectedStages]);

  const opStack = useMemo(() => {
    const keys = new Set<string>();
    for (const row of data.opTrends) {
      keys.add(`${row.provider}:${row.operation}`);
    }
    const topKeys = [...keys].slice(0, 6);
    const days = [...new Set(data.opTrends.map((r) => r.day))].sort();
    return days.map((day) => {
      const point: Record<string, string | number> = { day: day.slice(5) };
      for (const key of topKeys) {
        const [provider, operation] = key.split(":");
        const row = data.opTrends.find(
          (r) => r.day === day && r.provider === provider && r.operation === operation,
        );
        point[key] = row?.usd ?? 0;
      }
      return point;
    });
  }, [data.opTrends]);

  const throughput = useMemo(
    () =>
      data.runEfficiency
        .map((r) => ({
          day: r.day.slice(5),
          leads: r.leadsEnriched,
          avgMs: r.avgLeadDurationMs,
        }))
        .sort((a, b) => a.day.localeCompare(b.day)),
    [data.runEfficiency],
  );

  const effSplit = splitPeriod(data.runEfficiency, days);
  const avgUsdCurrent =
    effSplit.current.reduce((s, r) => s + (r.usdPerEnrichedLead ?? 0), 0) /
    Math.max(effSplit.current.length, 1);
  const avgUsdPrior =
    effSplit.prior.reduce((s, r) => s + (r.usdPerEnrichedLead ?? 0), 0) /
    Math.max(effSplit.prior.length, 1);
  const usdDelta = deltaBadge(avgUsdCurrent, avgUsdPrior);

  if (!data.viewsAvailable) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Trends unavailable</CardTitle>
          <CardDescription>
            Pipeline analytics views are not deployed yet. Run{" "}
            <code className="text-xs">supabase db push</code> after the migration lands.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <TabsList>
            {RANGES.map((r) => (
              <TabsTrigger key={r} value={String(r)}>
                {r}d
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Select value={market || "__all__"} onValueChange={(v) => setMarket(v === "__all__" ? "" : v)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Market" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All markets</SelectItem>
            {filterOptions.markets.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={category || "__all__"}
          onValueChange={(v) => setCategory(v === "__all__" ? "" : v)}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All categories</SelectItem>
            {filterOptions.categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TrendCard
          title="Cost per enriched lead"
          description="Unit economics — lower is better"
          delta={usdDelta}
        >
          <ChartContainer
            config={{
              usdPerLead: { label: "$/lead", color: "var(--chart-1)" },
              runs: { label: "Runs", color: "var(--chart-3)" },
            }}
            className="h-52"
          >
            <ComposedChart data={efficiencyChart}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="usd" tick={{ fontSize: 10 }} tickFormatter={(v) => formatUsdCompact(v)} />
              <YAxis yAxisId="runs" orientation="right" hide />
              <Bar yAxisId="runs" dataKey="runs" fill="var(--chart-3)" opacity={0.25} />
              <Line
                yAxisId="usd"
                type="monotone"
                dataKey="usdPerLead"
                stroke="var(--chart-1)"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ChartContainer>
        </TrendCard>

        <TrendCard title="Throughput" description="Leads enriched per day + avg wall time">
          <ChartContainer
            config={{
              leads: { label: "Leads", color: "var(--chart-2)" },
              avgMs: { label: "Avg ms", color: "var(--chart-4)" },
            }}
            className="h-52"
          >
            <ComposedChart data={throughput}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="leads" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="ms" orientation="right" tick={{ fontSize: 10 }} hide />
              <Bar yAxisId="leads" dataKey="leads" fill="var(--chart-2)" radius={[3, 3, 0, 0]} />
              <Line
                yAxisId="ms"
                type="monotone"
                dataKey="avgMs"
                stroke="var(--chart-4)"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ChartContainer>
        </TrendCard>

        <TrendCard
          title="Stage duration trends"
          description="Avg duration by stage — spot slowdowns"
          headerExtra={
            stageOptions.length > 0 ? (
              <ChipSelect
                options={stageOptions.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))}
                selected={selectedStages}
                onChange={setSelectedStages}
              />
            ) : null
          }
        >
          <ChartContainer
            config={Object.fromEntries(
              selectedStages.map((s, i) => [
                s,
                { label: s, color: `var(--chart-${(i % 5) + 1})` },
              ]),
            )}
            className="h-52"
          >
            <LineChart data={stageLines}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}s`} />
              {selectedStages.map((s, i) => (
                <Line
                  key={s}
                  type="monotone"
                  dataKey={s}
                  stroke={`var(--chart-${(i % 5) + 1})`}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ChartContainer>
        </TrendCard>

        <TrendCard title="Provider / operation cost mix" description="Stacked USD by tool">
          <ChartContainer
            config={{ mix: { label: "USD", color: "var(--chart-1)" } }}
            className="h-52"
          >
            <AreaChart data={opStack}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatUsdCompact(v)} />
              {Object.keys(opStack[0] ?? {})
                .filter((k) => k !== "day")
                .map((key, i) => (
                  <Area
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stackId="1"
                    stroke={`var(--chart-${(i % 5) + 1})`}
                    fill={`var(--chart-${(i % 5) + 1})`}
                    fillOpacity={0.35}
                  />
                ))}
            </AreaChart>
          </ChartContainer>
        </TrendCard>
      </div>
    </div>
  );
}

function TrendCard({
  title,
  description,
  delta,
  headerExtra,
  children,
}: {
  title: string;
  description: string;
  delta?: { label: string; tone: "up" | "down" | "flat" };
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          {delta ? (
            <Badge
              variant={delta.tone === "up" ? "destructive" : delta.tone === "down" ? "success" : "secondary"}
            >
              {delta.label} vs prior
            </Badge>
          ) : null}
        </div>
        {headerExtra}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

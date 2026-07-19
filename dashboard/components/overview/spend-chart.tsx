"use client";

import { useId, useMemo } from "react";
import {
  Area,
  AreaChart,
  ChartContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "@/components/ui/chart";
import type { CostDayRow } from "@/lib/types";
import { formatCredits, formatUsd } from "@/lib/utils";

function formatDayLabel(date: string): string {
  const parsed = Date.parse(`${date}T12:00:00`);
  if (!Number.isFinite(parsed)) return date;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(parsed);
}

function SpendTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: CostDayRow }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const parts = [
    row.browserUseUsd > 0
      ? { label: "Browser Use", value: formatUsd(row.browserUseUsd) }
      : null,
    row.googlePlacesUsd > 0
      ? { label: "Google Places", value: formatUsd(row.googlePlacesUsd) }
      : null,
    row.firecrawlCredits > 0
      ? { label: "Firecrawl", value: `${formatCredits(row.firecrawlCredits)} credits` }
      : null,
  ].filter((p): p is { label: string; value: string } => p != null);

  return (
    <div className="rounded-lg border border-border/80 bg-popover px-3 py-2 text-popover-foreground shadow-md">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {formatDayLabel(row.date)}
      </p>
      <p className="mt-1 text-sm font-semibold tabular-nums">{formatUsd(row.usd)}</p>
      {parts.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5 border-t border-border/50 pt-1.5">
          {parts.map((part) => (
            <li
              key={part.label}
              className="flex items-center justify-between gap-4 text-xs text-muted-foreground"
            >
              <span>{part.label}</span>
              <span className="tabular-nums text-foreground/90">{part.value}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">No provider breakdown</p>
      )}
    </div>
  );
}

export function SpendChart({ data }: { data: CostDayRow[] }) {
  const gradId = useId().replace(/:/g, "");
  const summary = useMemo(() => {
    if (data.length === 0) return null;
    const total = data.reduce((sum, d) => sum + d.usd, 0);
    const peak = data.reduce(
      (best, d) => (d.usd > best.usd ? d : best),
      data[0],
    );
    return { total, peak };
  }, [data]);

  if (data.length === 0) {
    return (
      <div className="flex h-full min-h-32 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border/70 bg-muted/20 px-4 text-center">
        <p className="text-sm font-medium text-foreground/80">No spend in the last 14 days</p>
        <p className="text-xs text-muted-foreground">
          Launch a market run and costs will plot here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      {summary ? (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-1 text-xs text-muted-foreground">
          <span>
            Total{" "}
            <span className="font-medium tabular-nums text-foreground">
              {formatUsd(summary.total)}
            </span>
          </span>
          <span>
            Peak {formatDayLabel(summary.peak.date)}{" "}
            <span className="font-medium tabular-nums text-foreground">
              {formatUsd(summary.peak.usd)}
            </span>
          </span>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <ChartContainer config={{ usd: { label: "USD", color: "var(--chart-1)" } }}>
          <AreaChart
            data={data}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id={`usdFill-${gradId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                <stop offset="55%" stopColor="var(--chart-2)" stopOpacity={0.12} />
                <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              tickFormatter={formatDayLabel}
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={28}
            />
            <YAxis
              width={40}
              tickFormatter={(v) => formatUsd(Number(v))}
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              tickCount={3}
            />
            <Tooltip
              content={SpendTooltip}
              cursor={{
                stroke: "var(--border)",
                strokeDasharray: "4 4",
              }}
            />
            <Area
              type="monotone"
              dataKey="usd"
              stroke="var(--chart-1)"
              strokeWidth={2.5}
              fill={`url(#usdFill-${gradId})`}
              animationDuration={900}
              activeDot={{
                r: 4,
                strokeWidth: 2,
                stroke: "var(--chart-1)",
                fill: "var(--background)",
              }}
            />
          </AreaChart>
        </ChartContainer>
      </div>
    </div>
  );
}

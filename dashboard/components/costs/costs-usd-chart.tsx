"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ChartContainer,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
} from "@/components/ui/chart";
import type { CostDayRow } from "@/lib/types";
import { formatUsd } from "@/lib/utils";

const PROVIDER_CHART_COLORS: Record<string, string> = {
  browser_use: "var(--chart-3)",
  google_places: "var(--chart-5)",
};

export function CostsUsdChart({ data }: { data: CostDayRow[] }) {
  return (
    <ChartContainer
      config={{
        browserUseUsd: { label: "Browser Use", color: PROVIDER_CHART_COLORS.browser_use },
        googlePlacesUsd: {
          label: "Google Places",
          color: PROVIDER_CHART_COLORS.google_places,
        },
      }}
    >
      <AreaChart data={data}>
        <defs>
          <linearGradient id="buFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0} />
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
          dataKey="googlePlacesUsd"
          stackId="usd"
          stroke="var(--chart-5)"
          fill="url(#gpFill)"
        />
      </AreaChart>
    </ChartContainer>
  );
}

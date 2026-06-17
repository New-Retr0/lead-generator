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
import { useIsMobile } from "@/hooks/use-mobile";
import type { CostDayRow } from "@/lib/types";
import { formatUsd } from "@/lib/utils";

const PROVIDER_CHART_COLORS: Record<string, string> = {
  browser_use: "var(--chart-3)",
  ai_gateway: "var(--chart-4)",
  google_places: "var(--chart-5)",
};

export function CostsUsdChart({ data }: { data: CostDayRow[] }) {
  const isMobile = useIsMobile();

  return (
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
      <AreaChart
        data={data}
        margin={{ top: 8, right: isMobile ? 4 : 12, left: isMobile ? -24 : 0, bottom: 0 }}
      >
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
        <XAxis
          dataKey="date"
          tick={{ fontSize: isMobile ? 9 : 10 }}
          tickFormatter={(v) => String(v).slice(5)}
          tickLine={false}
          axisLine={false}
          interval={isMobile ? "preserveStartEnd" : 0}
        />
        <YAxis
          tick={{ fontSize: isMobile ? 9 : 10 }}
          tickLine={false}
          axisLine={false}
          width={isMobile ? 34 : 48}
        />
        <Tooltip formatter={(v) => formatUsd(Number(v))} />
        {isMobile ? null : <Legend />}
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
  );
}

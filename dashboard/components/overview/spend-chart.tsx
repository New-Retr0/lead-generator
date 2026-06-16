"use client";

import { Area, AreaChart } from "@/components/ui/chart";
import { ChartContainer } from "@/components/ui/chart";
import type { CostDayRow } from "@/lib/types";

export function SpendChart({ data }: { data: CostDayRow[] }) {
  if (data.length === 0) {
    return (
      <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No cost events yet.
      </p>
    );
  }

  return (
    <ChartContainer config={{ usd: { label: "USD", color: "var(--chart-1)" } }}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="usdFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
            <stop offset="55%" stopColor="var(--chart-2)" stopOpacity={0.12} />
            <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="usd"
          stroke="var(--chart-1)"
          strokeWidth={2.5}
          fill="url(#usdFill)"
          animationDuration={900}
        />
      </AreaChart>
    </ChartContainer>
  );
}

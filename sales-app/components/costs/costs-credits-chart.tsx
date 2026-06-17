"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ChartContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "@/components/ui/chart";
import { useIsMobile } from "@/hooks/use-mobile";
import type { CostDayRow } from "@/lib/types";

export function CostsCreditsChart({ data }: { data: CostDayRow[] }) {
  const isMobile = useIsMobile();

  return (
    <ChartContainer
      config={{ firecrawlCredits: { label: "Credits", color: "var(--chart-2)" } }}
    >
      <BarChart
        data={data}
        margin={{ top: 8, right: isMobile ? 4 : 12, left: isMobile ? -24 : 0, bottom: 0 }}
      >
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
        <Tooltip />
        <Bar dataKey="firecrawlCredits" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

"use client";

import { Bar, BarChart, CartesianGrid, ChartContainer, Tooltip, XAxis, YAxis } from "@/components/ui/chart";
import type { CostDayRow } from "@/lib/types";

export function CostsCreditsChart({ data }: { data: CostDayRow[] }) {
  return (
    <ChartContainer
      config={{ firecrawlCredits: { label: "Credits", color: "var(--chart-2)" } }}
    >
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
        <Tooltip />
        <Bar dataKey="firecrawlCredits" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

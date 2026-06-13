"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

export type ChartConfig = Record<
  string,
  { label?: string; color?: string }
>;

const ChartContext = React.createContext<{ config: ChartConfig } | null>(null);

export function ChartContainer({
  config,
  className,
  children,
}: {
  config: ChartConfig;
  className?: string;
  children: React.ReactElement;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <ChartContext.Provider value={{ config }}>
      <div className={cn("h-full min-h-32 w-full min-w-0", className)}>
        {mounted ? (
          <ResponsiveContainer width="100%" height="100%">
            {children}
          </ResponsiveContainer>
        ) : null}
      </div>
    </ChartContext.Provider>
  );
}

export {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

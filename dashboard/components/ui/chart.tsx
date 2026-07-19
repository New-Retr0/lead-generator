"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
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
  children: React.ReactElement<{ width?: number; height?: number }>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 1 && height > 1) {
        setSize({ w: Math.floor(width), h: Math.floor(height) });
      }
    };

    update();
    // Fallback if layout is delayed (Safari / absolute parents / first paint).
    const fallback = window.setTimeout(() => {
      if (!ref.current) return;
      const { width, height } = ref.current.getBoundingClientRect();
      if (width > 1 && height > 1) {
        setSize({ w: Math.floor(width), h: Math.floor(height) });
      } else {
        setSize({ w: 480, h: 176 });
      }
    }, 32);

    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      window.clearTimeout(fallback);
      ro.disconnect();
    };
  }, []);

  return (
    <ChartContext.Provider value={{ config }}>
      <div ref={ref} className={cn("relative h-full min-h-32 w-full min-w-0", className)}>
        {size
          ? React.cloneElement(children, { width: size.w, height: size.h })
          : (
            <div className="h-full min-h-32 w-full animate-pulse rounded-md bg-muted/40" />
          )}
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

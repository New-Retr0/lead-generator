"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { CostDayRow } from "@/lib/types";

const SpendChart = dynamic(
  () => import("@/components/overview/spend-chart").then((m) => m.SpendChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-full w-full" />,
  },
);

export function SpendChartLazy({ data }: { data: CostDayRow[] }) {
  return <SpendChart data={data} />;
}

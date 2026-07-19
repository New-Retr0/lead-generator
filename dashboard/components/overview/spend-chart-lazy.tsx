"use client";

import { SpendChart } from "@/components/overview/spend-chart";
import type { CostDayRow } from "@/lib/types";

/** Direct import — dynamic() left this panel stuck on a grey skeleton when HMR chunks failed. */
export function SpendChartLazy({ data }: { data: CostDayRow[] }) {
  return <SpendChart data={data} />;
}

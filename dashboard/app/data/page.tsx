import { Suspense } from "react";
import { DataExplorer } from "@/components/data/data-explorer";
import { DataPageFallback } from "@/components/data/data-page-fallback";
import { getPipelineConfig } from "@/lib/config";
import { listLeads } from "@/lib/db";
import { parseInventoryMode } from "@/lib/lead-labels";
import type { InventoryMode } from "@/lib/types";

export const dynamic = "force-dynamic";

function firstParam(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

export default async function DataPage({
  searchParams,
}: {
  searchParams: Promise<{
    inventory?: string | string[];
    tab?: string | string[];
    market?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const inventoryMode: InventoryMode = parseInventoryMode(firstParam(params.inventory));
  const tabRaw = firstParam(params.tab);
  const market = firstParam(params.market);
  const [leads, config] = await Promise.all([
    listLeads({
      limit: 1000,
      inventoryMode,
      type: tabRaw === "vendors" ? "vendor" : undefined,
      market: market || undefined,
    }),
    getPipelineConfig(),
  ]);

  return (
    <Suspense fallback={<DataPageFallback />}>
      <DataExplorer
        initialLeads={leads}
        config={config}
        initialInventoryMode={inventoryMode}
      />
    </Suspense>
  );
}

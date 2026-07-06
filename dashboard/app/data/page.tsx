import { Suspense } from "react";
import { DataExplorer } from "@/components/data/data-explorer";
import { getPipelineConfig } from "@/lib/config";
import { listLeads } from "@/lib/db";

export default async function DataPage() {
  const [leads, config] = await Promise.all([
    listLeads({ limit: 1000 }),
    getPipelineConfig(),
  ]);

  return (
    <Suspense fallback={null}>
      <DataExplorer initialLeads={leads} config={config} />
    </Suspense>
  );
}

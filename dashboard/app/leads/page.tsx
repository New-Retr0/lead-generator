import { Suspense } from "react";
import { LeadsClient } from "@/components/leads/leads-client";
import { getPipelineConfig } from "@/lib/config";
import { listLeads } from "@/lib/db";

export default async function LeadsPage() {
  const [leads, config] = await Promise.all([
    listLeads({ limit: 1000 }),
    getPipelineConfig(),
  ]);

  return (
    <Suspense fallback={null}>
      <LeadsClient initialLeads={leads} config={config} />
    </Suspense>
  );
}

import { TriageClient } from "@/components/triage/triage-client";
import { getPipelineConfig } from "@/lib/config";
import { listLeads } from "@/lib/db";

export default async function TriagePage() {
  const [leads, config] = await Promise.all([
    listLeads({ dudsOnly: true, limit: 200 }),
    getPipelineConfig(),
  ]);
  return <TriageClient initialLeads={leads} config={config} />;
}

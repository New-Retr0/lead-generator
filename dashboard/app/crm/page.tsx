import { CrmClient } from "@/components/crm/crm-client";
import { getPipelineConfig } from "@/lib/config";
import { listLeads } from "@/lib/db";

export default async function CrmPage() {
  const [leads, config] = await Promise.all([
    listLeads({ limit: 1000 }),
    getPipelineConfig(),
  ]);
  return <CrmClient initialLeads={leads} config={config} />;
}

import { RequestsPageClient } from "@/components/requests/requests-page-client";
import { getPipelineConfig } from "@/lib/config";
import { listRequests } from "@/lib/db";

export default async function RequestsPage() {
  const [requests, config] = await Promise.all([listRequests(), getPipelineConfig()]);

  return <RequestsPageClient requests={requests} config={config} />;
}

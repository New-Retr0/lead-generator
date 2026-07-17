import { RequestsPageClient } from "@/components/requests/requests-page-client";
import { getPipelineConfig } from "@/lib/config";
import { listRequests } from "@/lib/db";
import { getRequestCreditBudget } from "@/lib/request-budget";

export default async function RequestsPage() {
  const [requests, config, requestBudget] = await Promise.all([
    listRequests(),
    getPipelineConfig(),
    getRequestCreditBudget(),
  ]);

  return (
    <RequestsPageClient
      requests={requests}
      config={config}
      requestBudget={requestBudget}
    />
  );
}

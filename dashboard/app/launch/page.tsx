import { Suspense } from "react";
import { LaunchPageClient } from "@/components/launch/launch-page-client";
import { Skeleton } from "@/components/ui/skeleton";
import { getPipelineConfig } from "@/lib/config";
import { listRequests } from "@/lib/db";
import { getRequestCreditBudget } from "@/lib/request-budget";

export const dynamic = "force-dynamic";

function LaunchFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export default async function LaunchPage() {
  const [requests, config, requestBudget] = await Promise.all([
    listRequests(),
    getPipelineConfig(),
    getRequestCreditBudget(),
  ]);

  return (
    <Suspense fallback={<LaunchFallback />}>
      <LaunchPageClient
        requests={requests}
        config={config}
        requestBudget={requestBudget}
      />
    </Suspense>
  );
}

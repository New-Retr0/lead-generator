import { Suspense } from "react";
import { WorkspaceClient } from "@/components/workspace/workspace-client";
import { Skeleton } from "@/components/ui/skeleton";
import { getPipelineConfig } from "@/lib/config";
import { listLeads } from "@/lib/db";

export default async function WorkspacePage() {
  const [leads, config] = await Promise.all([
    listLeads({ limit: 1000 }),
    getPipelineConfig(),
  ]);

  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <Skeleton className="h-5 w-96" />
          <Skeleton className="h-10 w-full max-w-lg" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      }
    >
      <WorkspaceClient initialLeads={leads} config={config} />
    </Suspense>
  );
}

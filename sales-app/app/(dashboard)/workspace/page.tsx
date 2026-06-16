import { WorkspaceClient, type WorkspaceTab } from "@/components/workspace/workspace-client";
import { getPipelineConfig } from "@/lib/config";
import { listLeads } from "@/lib/db";

type WorkspaceSearchParams = {
  tab?: string | string[];
  place?: string | string[];
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseTab(value: string | undefined): WorkspaceTab {
  if (value === "client" || value === "vendor" || value === "triage" || value === "all") {
    return value;
  }
  return "all";
}

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<WorkspaceSearchParams>;
}) {
  const [leads, config, params] = await Promise.all([
    listLeads({ limit: 1000 }),
    getPipelineConfig(),
    searchParams,
  ]);
  const initialTab = parseTab(firstParam(params.tab));
  const initialPlaceId = firstParam(params.place) ?? null;

  return (
    <WorkspaceClient
      key={`${initialTab}:${initialPlaceId ?? ""}`}
      initialLeads={leads}
      config={config}
      initialTab={initialTab}
      initialPlaceId={initialPlaceId}
    />
  );
}

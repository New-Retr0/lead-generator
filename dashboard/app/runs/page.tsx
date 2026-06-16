import { RunsPageClient } from "@/components/runs/runs-page-client";
import { getPipelineConfig } from "@/lib/config";
import { listRuns } from "@/lib/db";

export default async function RunsPage() {
  const [runs, config] = await Promise.all([listRuns(), getPipelineConfig()]);
  return <RunsPageClient initialRuns={runs} config={config} />;
}

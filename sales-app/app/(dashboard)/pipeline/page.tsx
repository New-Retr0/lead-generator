import { PipelineStudio } from "@/components/pipeline/pipeline-studio";
import { PageHeader } from "@/components/page-header";
import { getPipelineConfig } from "@/lib/config";
import { getPipelineTrends, listFilterOptions, listRuns } from "@/lib/db";

export default async function PipelinePage() {
  const [runs, config, filterOptions, trends] = await Promise.all([
    listRuns(40).catch(() => []),
    getPipelineConfig(),
    listFilterOptions().catch(() => ({ markets: [], categories: [] })),
    getPipelineTrends(30).catch(() => ({
      stageTrends: [],
      opTrends: [],
      runEfficiency: [],
      stageStatsByRun: [],
      viewsAvailable: false,
    })),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader description="Live animated pipeline graph with per-stage costs, replay, granularity rollup, and historical trends." />
      <PipelineStudio
        runs={runs}
        config={config}
        trendsInitialDays={30}
        trendsInitialData={trends}
        filterOptions={filterOptions}
      />
    </div>
  );
}

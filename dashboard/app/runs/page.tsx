import { RunsPageClient } from "@/components/runs/runs-page-client";
import { getPipelineConfig } from "@/lib/config";
import { listRuns } from "@/lib/db";
import { listJobSummaries } from "@/lib/jobs";
import { repairOrphanedRuns } from "@/lib/run-reconcile";

export const dynamic = "force-dynamic";

export default async function RunsPage({
  searchParams,
}: {
  searchParams?: Promise<{ job?: string }>;
}) {
  const params = searchParams ? await searchParams : {};
  await repairOrphanedRuns();
  const [runs, jobs, config] = await Promise.all([
    listRuns(),
    listJobSummaries(20),
    getPipelineConfig(),
  ]);
  const jobFilter = params.job ?? null;
  return (
    <RunsPageClient
      key={jobFilter ?? "all"}
      initialRuns={runs}
      initialJobs={jobs}
      config={config}
      initialJobFilter={jobFilter}
    />
  );
}

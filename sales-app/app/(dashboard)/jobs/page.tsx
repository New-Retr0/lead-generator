import { JobsClient } from "@/components/jobs/jobs-client";
import { PageHeader } from "@/components/page-header";
import { getPipelineConfig } from "@/lib/config";
import { listPipelineJobs } from "@/lib/db";

export default async function JobsPage() {
  const [jobs, config] = await Promise.all([
    listPipelineJobs(25).catch(() => []),
    getPipelineConfig(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader description="Queue pipeline commands for the worker without exposing service credentials to the web app." />
      <JobsClient initialJobs={jobs} config={config} />
    </div>
  );
}

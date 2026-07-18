import { getRunDetail } from "@/lib/db";
import { findJobByRunId, getJob, loadPersistedJob } from "@/lib/jobs";
import type { JobRecord, RunDetail } from "@/lib/types";

export type RunDetailResponse = RunDetail & {
  liveJobId?: string | null;
  liveJobStatus?: string | null;
  liveJobFinishedAt?: string | null;
  liveNames?: Record<string, string>;
  liveDiscovered?: number | null;
  orphanedRunning?: boolean;
};

function resolveParentJob(run: RunDetail["run"]): JobRecord | null {
  if (run.job_id) {
    return getJob(run.job_id) ?? loadPersistedJob(run.job_id);
  }
  return findJobByRunId(run.run_id);
}

/** Shared payload for /runs/[id] SSR and /api/runs/[id]. */
export async function buildRunDetailResponse(
  runId: string,
): Promise<RunDetailResponse | null> {
  const detail = await getRunDetail(runId);
  if (!detail) return null;

  const liveJob = resolveParentJob(detail.run);
  const liveNames: Record<string, string> = {};
  let liveDiscovered: number | null = null;
  if (liveJob) {
    for (const evt of liveJob.events) {
      if (evt.place_id && typeof evt.business === "string" && evt.business) {
        liveNames[evt.place_id] = evt.business;
      }
      if (evt.event === "discovery_done" && typeof evt.count === "number") {
        liveDiscovered = evt.count;
      }
    }
  }

  const jobTerminal =
    liveJob != null &&
    liveJob.status !== "running" &&
    liveJob.status !== "pending";
  const orphanedRunning = detail.run.status === "running" && jobTerminal;

  return {
    ...detail,
    liveJobId: liveJob?.id ?? detail.run.job_id ?? null,
    liveJobStatus: liveJob?.status ?? null,
    liveJobFinishedAt: liveJob?.finishedAt ?? null,
    liveNames,
    liveDiscovered,
    orphanedRunning,
  };
}

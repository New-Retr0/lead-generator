"use client";

import { useMemo } from "react";
import { motion } from "motion/react";
import ASCIIAnimation from "@/components/console/ascii-animation";
import { enter } from "@/components/console/motion";
import { PipelinePlayer } from "@/components/pipeline/pipeline-player";
import { useReplayState } from "@/components/pipeline/replay-controls";
import { Skeleton } from "@/components/ui/skeleton";
import {
  computeStageActivity,
  usePipelineStream,
} from "@/lib/pipeline/use-pipeline-stream";
import type { RunStreamInitial } from "@/lib/pipeline/use-run-stream";
import type { RunTimeline } from "@/lib/types";

const ASCII_DEFAULT_COLOR =
  "color-mix(in oklab, var(--foreground) 80%, var(--primary) 20%)";

export function RunPipelinePanel({
  runId,
  status,
  startedAt,
  finishedAt,
  initialStudio = null,
  runTimeline = null,
  liveNames,
}: {
  runId: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  initialStudio?: RunStreamInitial | null;
  runTimeline?: RunTimeline | null;
  liveNames?: Record<string, string>;
}) {
  // Match useRunStream poll window — pending cells must stay in live Studio mode.
  const isLive = status === "running" || status === "pending";
  const stream = usePipelineStream(runId, {
    enabled: true,
    realtime: true,
    initial: initialStudio,
  });
  const replay = useReplayState(runId, isLive);

  const hasTelemetry = useMemo(
    () => stream.costs.length > 0 || stream.events.length > 0,
    [stream.costs.length, stream.events],
  );

  const activeStages = useMemo(
    () => computeStageActivity(stream.timeline, replay.virtualMs),
    [stream.timeline, replay.virtualMs],
  );

  if (stream.loading) {
    return <Skeleton className="min-h-[28rem] w-full rounded-2xl" />;
  }

  if (!hasTelemetry) {
    return (
      <motion.div
        className="relative overflow-hidden rounded-2xl border border-dashed border-border/60 bg-muted/10 p-6 text-center"
        {...enter.fade}
      >
        <div className="pointer-events-none absolute inset-0 flex items-end justify-center opacity-30">
          <ASCIIAnimation
            frameFolder="computer"
            frameCount={78}
            quality="medium"
            fps={12}
            className="h-20 w-36"
            color={ASCII_DEFAULT_COLOR}
            gradient="linear-gradient(160deg, var(--foreground), var(--primary))"
            lazy
            ariaLabel="Computer animation"
          />
        </div>
        <p className="relative text-sm font-medium">
          {stream.connected
            ? "No stage or cost ledger for this run"
            : "Waiting for Pipeline Studio connection…"}
        </p>
        <p className="relative mx-auto mt-1 max-w-md text-xs text-muted-foreground">
          {stream.connected
            ? "New market, campaign, and request runs always emit Studio telemetry."
            : "Dashboard needs SUPABASE_DB_URL to load Studio telemetry from Postgres."}
        </p>
      </motion.div>
    );
  }

  return (
    <div className="min-w-0 w-full max-w-full">
      <PipelinePlayer
        timeline={stream.timeline}
        costs={stream.costs}
        events={stream.events}
        stageStats={stream.stageStats}
        stageRollup={stream.stageRollup}
        activeStages={activeStages}
        isLive={isLive}
        playing={replay.playing}
        onPlayingChange={replay.setPlaying}
        virtualMs={replay.virtualMs}
        onVirtualMsChange={replay.setVirtualMs}
        speed={replay.speed}
        onSpeedChange={replay.setSpeed}
        runStartedAt={startedAt}
        runEndedAt={finishedAt}
        runTimeline={runTimeline}
        liveNames={liveNames}
      />
    </div>
  );
}

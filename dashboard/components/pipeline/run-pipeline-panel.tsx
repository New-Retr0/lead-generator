"use client";

import { useMemo } from "react";
import { useReducedMotion } from "motion/react";
import ASCIIAnimation from "@/components/console/ascii-animation";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  computeStageActivity,
  sliceTimeline,
  usePipelineStream,
} from "@/lib/pipeline/use-pipeline-stream";
import { PipelineCanvas } from "@/components/pipeline/pipeline-canvas";
import { ReplayControls, useReplayState } from "@/components/pipeline/replay-controls";

const ASCII_DEFAULT_COLOR =
  "color-mix(in oklab, var(--foreground) 80%, var(--primary) 20%)";

export function RunPipelinePanel({
  runId,
  status,
  startedAt,
  finishedAt,
}: {
  runId: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
}) {
  const reduced = useReducedMotion();
  const isLive = status === "running";
  const stream = usePipelineStream(runId, { enabled: true, realtime: true });
  const replay = useReplayState(isLive);

  const hasTelemetry = useMemo(
    () =>
      stream.costs.length > 0 ||
      stream.events.some(
        (e) =>
          e.event === "lead_started" ||
          e.event === "discovery_done" ||
          e.event === "lead_done" ||
          e.event === "stage_done",
      ),
    [stream.costs.length, stream.events],
  );

  const slicedTimeline = useMemo(
    () => sliceTimeline(stream.timeline, replay.virtualMs),
    [stream.timeline, replay.virtualMs],
  );

  const activeStages = useMemo(
    () => computeStageActivity(stream.timeline, replay.virtualMs),
    [stream.timeline, replay.virtualMs],
  );

  if (stream.loading) {
    return <Skeleton className="h-96 w-full rounded-lg" />;
  }

  if (!hasTelemetry && stream.events.length === 0) {
    return (
      <div className="relative overflow-hidden rounded-lg border border-dashed border-border/60 bg-muted/10 p-8 text-center">
        <div className="pointer-events-none absolute inset-0 flex items-end justify-center opacity-40">
          <ASCIIAnimation
            frameFolder="computer"
            frameCount={78}
            quality="medium"
            fps={12}
            className="h-24 w-40"
            color={ASCII_DEFAULT_COLOR}
            gradient="linear-gradient(160deg, var(--foreground), var(--primary))"
            lazy
            ariaLabel="Computer animation"
          />
        </div>
        <p className="relative text-sm font-medium">No replay telemetry for this run</p>
        <p className="relative mx-auto mt-1 max-w-md text-xs text-muted-foreground">
          New runs record stage progress automatically — open a recent run to see the
          animated pipeline canvas and video-style replay.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="glass overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Pipeline canvas</CardTitle>
          <CardDescription>
            {isLive
              ? "Live enrichment DAG — polling every 3s while run is active."
              : "Scrub replay below to re-watch tool calls traverse the pipeline."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PipelineCanvas
            stageStats={stream.stageStats}
            stageRollup={stream.stageRollup}
            timeline={slicedTimeline}
            replayUpToMs={replay.virtualMs}
            activeStages={activeStages}
            reducedMotion={reduced ?? false}
          />
        </CardContent>
      </Card>

      {!isLive ? (
        <Card className="glass">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Replay</CardTitle>
          </CardHeader>
          <CardContent>
            <ReplayControls
              timeline={stream.timeline}
              runStartedAt={startedAt}
              runEndedAt={finishedAt}
              playing={replay.playing}
              onPlayingChange={replay.setPlaying}
              virtualMs={replay.virtualMs}
              onVirtualMsChange={replay.setVirtualMs}
              speed={replay.speed}
              onSpeedChange={replay.setSpeed}
              stageStats={stream.stageStats}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

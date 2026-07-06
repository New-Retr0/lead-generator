"use client";

import { useMemo, useState } from "react";
import { LiveDot } from "@/components/animated";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Granularity } from "@/lib/pipeline/rollup";
import { rollupByStage, stageStats } from "@/lib/pipeline/rollup";
import {
  computeStageActivity,
  sliceTimeline,
  usePipelineStream,
} from "@/lib/pipeline/use-pipeline-stream";
import type { PipelineConfig, PipelineTrends, RunRow } from "@/lib/types";
import { CostLedgerPanel } from "./cost-ledger-panel";
import { PipelineCanvas } from "./pipeline-canvas";
import { ReplayControls, useReplayState } from "./replay-controls";
import { RunControlsCard } from "./run-controls-card";
import { TrendsPanel } from "./trends-panel";

function fmtRunLabel(run: RunRow): string {
  const when = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(run.started_at));
  const scope = [run.market_key, run.category_key].filter(Boolean).join(" · ");
  return `${when}${scope ? ` — ${scope}` : ""} (${run.enriched_count} enriched)`;
}

export function PipelineStudio({
  runs,
  config,
  trendsInitialDays,
  trendsInitialData,
  filterOptions,
}: {
  runs: RunRow[];
  config: PipelineConfig;
  trendsInitialDays: number;
  trendsInitialData: PipelineTrends;
  filterOptions: { markets: string[]; categories: string[] };
}) {
  const running = runs.find((r) => r.status === "running");
  const defaultRunId = running?.run_id ?? runs[0]?.run_id ?? "";
  const [runId, setRunId] = useState(defaultRunId);
  const [granularity, setGranularity] = useState<Granularity>(2);
  const [realtimeEnabled, setRealtimeEnabled] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [tab, setTab] = useState("studio");

  const selectedRun = runs.find((r) => r.run_id === runId);
  const isLive = selectedRun?.status === "running";

  const stream = usePipelineStream(runId || null, { realtime: realtimeEnabled });
  const replay = useReplayState(Boolean(isLive));

  const slicedTimeline = useMemo(
    () => sliceTimeline(stream.timeline, replay.virtualMs),
    [stream.timeline, replay.virtualMs],
  );

  const slicedCosts = useMemo(() => {
    if (replay.virtualMs == null) return stream.costs;
    return stream.costs.filter(
      (c) => new Date(c.created_at).getTime() <= replay.virtualMs!,
    );
  }, [stream.costs, replay.virtualMs]);

  const slicedEvents = useMemo(() => {
    if (replay.virtualMs == null) return stream.events;
    return stream.events.filter(
      (e) => new Date(e.ts).getTime() <= replay.virtualMs!,
    );
  }, [stream.events, replay.virtualMs]);

  const displayStats = useMemo(
    () => stageStats(slicedCosts, slicedEvents),
    [slicedCosts, slicedEvents],
  );

  const displayRollup = useMemo(() => {
    if (granularity === 2) return rollupByStage(slicedCosts);
    return rollupByStage(slicedCosts);
  }, [slicedCosts, granularity]);

  const activeStages = useMemo(
    () => computeStageActivity(stream.timeline, replay.virtualMs),
    [stream.timeline, replay.virtualMs],
  );

  const sortedRuns = useMemo(() => {
    return [...runs].sort((a, b) => {
      if (a.status === "running" && b.status !== "running") return -1;
      if (b.status === "running" && a.status !== "running") return 1;
      return b.started_at.localeCompare(a.started_at);
    });
  }, [runs]);

  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="studio">Studio</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
        </TabsList>

        {tab === "studio" ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:max-w-xl sm:justify-end">
            <Select value={runId} onValueChange={setRunId}>
              <SelectTrigger className="w-full sm:w-[320px]">
                <SelectValue placeholder="Select run" />
              </SelectTrigger>
              <SelectContent>
                {sortedRuns.map((run) => (
                  <SelectItem key={run.run_id} value={run.run_id}>
                    <span className="flex items-center gap-2">
                      {run.status === "running" ? <LiveDot className="size-2" /> : null}
                      {fmtRunLabel(run)}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isLive ? (
              <Badge variant="warning" className="gap-1.5">
                <LiveDot tone="warning" />
                Live
              </Badge>
            ) : (
              <Badge variant="secondary">Replay</Badge>
            )}
            {stream.connected && realtimeEnabled ? (
              <Badge variant="outline" className="text-[10px]">
                Realtime
              </Badge>
            ) : null}
          </div>
        ) : null}
      </div>

      <TabsContent value="studio" className="space-y-4">
        <div className="grid gap-4 xl:grid-cols-[1fr_minmax(280px,340px)]">
          <div className="space-y-4 min-w-0">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Pipeline canvas</CardTitle>
                <CardDescription>
                  {isLive
                    ? "Watching live tool calls traverse the enrichment DAG."
                    : "Scrub replay below to re-aggregate costs up to a point in time."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PipelineCanvas
                  stageStats={displayStats}
                  stageRollup={displayRollup}
                  timeline={slicedTimeline}
                  replayUpToMs={replay.virtualMs}
                  activeStages={activeStages}
                  reducedMotion={reducedMotion}
                />
              </CardContent>
            </Card>

            {!isLive ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Replay</CardTitle>
                </CardHeader>
                <CardContent>
                  <ReplayControls
                    timeline={stream.timeline}
                    runStartedAt={selectedRun?.started_at ?? null}
                    runEndedAt={selectedRun?.finished_at ?? null}
                    playing={replay.playing}
                    onPlayingChange={replay.setPlaying}
                    virtualMs={replay.virtualMs}
                    onVirtualMsChange={replay.setVirtualMs}
                    speed={replay.speed}
                    onSpeedChange={replay.setSpeed}
                    stageStats={displayStats}
                  />
                </CardContent>
              </Card>
            ) : null}
          </div>

          <div className="space-y-4">
            <CostLedgerPanel
              events={slicedCosts}
              granularity={granularity}
              onGranularityChange={setGranularity}
            />
            <RunControlsCard
              config={config}
              realtimeEnabled={realtimeEnabled}
              onRealtimeChange={setRealtimeEnabled}
              reducedMotion={reducedMotion}
              onReducedMotionChange={setReducedMotion}
            />
          </div>
        </div>
      </TabsContent>

      <TabsContent value="trends">
        <TrendsPanel
          initialDays={trendsInitialDays}
          initialData={trendsInitialData}
          filterOptions={filterOptions}
        />
      </TabsContent>
    </Tabs>
  );
}

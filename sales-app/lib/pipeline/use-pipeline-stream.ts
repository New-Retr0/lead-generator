"use client";

import { useMemo } from "react";
import type { JobEvent } from "@/lib/types";
import { rollupByStage, stageStats, type Granularity } from "@/lib/pipeline/rollup";
import {
  eventToStage,
  normalizeCostRow,
  type PipelineCostEvent,
  type PipelineTimelineEntry,
} from "@/lib/pipeline/stages";
import { useRunStream, type RunStreamCost } from "@/lib/use-run-stream";

export type PipelineStreamState = {
  events: JobEvent[];
  costs: PipelineCostEvent[];
  timeline: PipelineTimelineEntry[];
  stageStats: ReturnType<typeof stageStats>;
  stageRollup: Map<string, import("@/lib/pipeline/rollup").CostGroup>;
  totalUsd: number;
  usdPerMinute: number;
  connected: boolean;
  loading: boolean;
};

function toPipelineCost(row: RunStreamCost): PipelineCostEvent {
  return normalizeCostRow({
    id: row.id,
    usd: row.usd,
    provider: row.provider,
    operation: row.operation,
    model: row.model,
    units: row.units,
    unit_type: row.unit_type,
    place_id: row.place_id,
    meta_json: row.meta_json,
    created_at: row.created_at,
  });
}

function buildTimeline(
  events: JobEvent[],
  costs: PipelineCostEvent[],
): PipelineTimelineEntry[] {
  const entries: PipelineTimelineEntry[] = [
    ...events.map((event) => ({
      kind: "event" as const,
      ts: event.ts,
      event,
      duration_ms:
        typeof event.duration_ms === "number" ? event.duration_ms : undefined,
    })),
    ...costs.map((cost) => ({
      kind: "cost" as const,
      ts: cost.created_at,
      cost,
    })),
  ];
  entries.sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
  );
  return entries;
}

export function sliceTimeline(
  timeline: PipelineTimelineEntry[],
  upToMs: number | null,
): PipelineTimelineEntry[] {
  if (upToMs == null) return timeline;
  return timeline.filter((entry) => new Date(entry.ts).getTime() <= upToMs);
}

export function computeStageActivity(
  timeline: PipelineTimelineEntry[],
  upToMs: number | null,
): Set<string> {
  const active = new Set<string>();
  for (const entry of sliceTimeline(timeline, upToMs)) {
    if (entry.kind === "cost") {
      active.add(entry.cost.stage);
    } else {
      const stage = eventToStage(entry.event);
      if (stage) active.add(stage);
    }
  }
  return active;
}

export function usePipelineStream(
  runId: string | null,
  options?: { enabled?: boolean; realtime?: boolean },
): PipelineStreamState {
  const enabled = options?.enabled ?? true;
  const realtime = options?.realtime ?? true;
  const stream = useRunStream(runId, enabled && realtime);

  const costs = useMemo(
    () => stream.costs.map(toPipelineCost),
    [stream.costs],
  );

  const timeline = useMemo(
    () => buildTimeline(stream.events, costs),
    [stream.events, costs],
  );

  const stats = useMemo(
    () => stageStats(costs, stream.events),
    [costs, stream.events],
  );

  const stageRollup = useMemo(() => rollupByStage(costs), [costs]);

  return {
    events: stream.events,
    costs,
    timeline,
    stageStats: stats,
    stageRollup,
    totalUsd: stream.totalUsd,
    usdPerMinute: stream.usdPerMinute,
    connected: stream.connected,
    loading: stream.loading,
  };
}

export type { Granularity, PipelineCostEvent, PipelineTimelineEntry };

import { rollupCosts, type CostGroup, type StageStat } from "@/lib/pipeline/rollup";
import {
  PIPELINE_STAGES,
  canonicalStageId,
  eventToStage,
  type PipelineCostEvent,
  type PipelineTimelineEntry,
} from "@/lib/pipeline/stages";
import type { JobEvent } from "@/lib/types";

export const REPLAY_SPEEDS = [1, 2, 4] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

export type StageSegment = {
  stageId: string;
  startMs: number;
  endMs: number;
};

export type PlaybackFrame = {
  stageId: string;
  segmentProgress: number;
  dwellMs: number;
  runUsd: number;
  stageUsd: number;
  hitCount: number;
  segmentIndex: number;
  segmentCount: number;
};

function entryStage(entry: PipelineTimelineEntry): string | null {
  if (entry.kind === "cost") return entry.cost.stage;
  return eventToStage(entry.event);
}

function sumUsdUpTo(costs: PipelineCostEvent[], upToMs: number): number {
  let total = 0;
  for (const cost of costs) {
    if (new Date(cost.created_at).getTime() <= upToMs) total += cost.usd;
  }
  return total;
}

function sumStageUsdUpTo(
  costs: PipelineCostEvent[],
  stageId: string,
  upToMs: number,
): number {
  let total = 0;
  for (const cost of costs) {
    if (cost.stage !== stageId) continue;
    if (new Date(cost.created_at).getTime() <= upToMs) total += cost.usd;
  }
  return total;
}

function countStageHitsUpTo(
  timeline: PipelineTimelineEntry[],
  stageId: string,
  upToMs: number,
): number {
  let count = 0;
  for (const entry of timeline) {
    const ms = new Date(entry.ts).getTime();
    if (ms > upToMs) break;
    if (entryStage(entry) === stageId) count += 1;
  }
  return count;
}

/** Collapse the timeline into contiguous stage dwells — circles only move on these edges. */
export function buildStageSegments(
  timeline: PipelineTimelineEntry[],
  bounds: { start: number; end: number },
): StageSegment[] {
  const changes: { ms: number; stageId: string }[] = [];
  for (const entry of timeline) {
    const stageId = entryStage(entry);
    if (!stageId) continue;
    const ms = new Date(entry.ts).getTime();
    const last = changes[changes.length - 1];
    if (!last || last.stageId !== stageId) {
      changes.push({ ms, stageId });
    }
  }

  if (changes.length === 0) {
    return [
      {
        stageId: PIPELINE_STAGES[0]?.id ?? "discovery",
        startMs: bounds.start,
        endMs: bounds.end,
      },
    ];
  }

  const segments: StageSegment[] = [];
  for (let i = 0; i < changes.length; i += 1) {
    const startMs = i === 0 ? bounds.start : changes[i].ms;
    const endMs = i + 1 < changes.length ? changes[i + 1].ms : bounds.end;
    segments.push({
      stageId: changes[i].stageId,
      startMs,
      endMs: Math.max(endMs, startMs + 1),
    });
  }
  return segments;
}

/**
 * Stage identity is sticky to the active segment.
 * Money / hits lerp from segment-start → segment-end so counters climb until the next stage.
 */
export function resolvePlaybackFrame(
  playheadMs: number,
  segments: StageSegment[],
  costs: PipelineCostEvent[],
  timeline: PipelineTimelineEntry[],
): PlaybackFrame {
  const fallbackId = PIPELINE_STAGES[0]?.id ?? "discovery";
  if (segments.length === 0) {
    return {
      stageId: fallbackId,
      segmentProgress: 1,
      dwellMs: 0,
      runUsd: sumUsdUpTo(costs, playheadMs),
      stageUsd: 0,
      hitCount: 0,
      segmentIndex: 0,
      segmentCount: 0,
    };
  }

  let index = 0;
  for (let i = 0; i < segments.length; i += 1) {
    if (playheadMs >= segments[i].startMs) index = i;
    if (playheadMs >= segments[i].startMs && playheadMs < segments[i].endMs) {
      index = i;
      break;
    }
  }
  if (playheadMs >= segments[segments.length - 1].endMs) {
    index = segments.length - 1;
  }

  const seg = segments[index];
  const span = Math.max(seg.endMs - seg.startMs, 1);
  const t = Math.min(1, Math.max(0, (playheadMs - seg.startMs) / span));

  const runStart = sumUsdUpTo(costs, seg.startMs);
  const runEnd = sumUsdUpTo(costs, seg.endMs);
  const stageStart = sumStageUsdUpTo(costs, seg.stageId, seg.startMs);
  const stageEnd = sumStageUsdUpTo(costs, seg.stageId, seg.endMs);
  const hitsStart = countStageHitsUpTo(timeline, seg.stageId, seg.startMs);
  const hitsEnd = countStageHitsUpTo(timeline, seg.stageId, seg.endMs);

  return {
    stageId: seg.stageId,
    segmentProgress: t,
    dwellMs: Math.max(0, Math.min(playheadMs, seg.endMs) - seg.startMs),
    runUsd: runStart + (runEnd - runStart) * t,
    stageUsd: stageStart + (stageEnd - stageStart) * t,
    hitCount: hitsStart + (hitsEnd - hitsStart) * t,
    segmentIndex: index,
    segmentCount: segments.length,
  };
}

export function formatClock(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export function timelineBounds(
  timeline: PipelineTimelineEntry[],
  runStartedAt: string | null,
  runEndedAt: string | null,
): { start: number; end: number } {
  if (timeline.length === 0) {
    const start = runStartedAt ? new Date(runStartedAt).getTime() : Date.now();
    const end = runEndedAt ? new Date(runEndedAt).getTime() : start + 60_000;
    return { start, end: Math.max(end, start + 1000) };
  }
  const start = new Date(timeline[0].ts).getTime();
  const end = new Date(timeline[timeline.length - 1].ts).getTime();
  return { start, end: Math.max(end, start + 1000) };
}

export function sliceByMs<T extends { ts?: string; created_at?: string }>(
  rows: T[],
  upToMs: number | null,
  getTs: (row: T) => string,
): T[] {
  if (upToMs == null) return rows;
  return rows.filter((row) => new Date(getTs(row)).getTime() <= upToMs);
}

export function sliceTimeline(
  timeline: PipelineTimelineEntry[],
  upToMs: number | null,
): PipelineTimelineEntry[] {
  if (upToMs == null) return timeline;
  return timeline.filter((entry) => new Date(entry.ts).getTime() <= upToMs);
}

export function sliceCosts(
  costs: PipelineCostEvent[],
  upToMs: number | null,
): PipelineCostEvent[] {
  return sliceByMs(costs, upToMs, (c) => c.created_at);
}

export function currentFocusStage(
  timeline: PipelineTimelineEntry[],
  upToMs: number | null,
  active: Set<string>,
): string {
  const visible = sliceTimeline(timeline, upToMs);
  for (let i = visible.length - 1; i >= 0; i -= 1) {
    const entry = visible[i];
    if (entry.kind === "cost") return entry.cost.stage;
    const stage = eventToStage(entry.event);
    if (stage) return stage;
  }
  for (let i = PIPELINE_STAGES.length - 1; i >= 0; i -= 1) {
    if (active.has(PIPELINE_STAGES[i].id)) return PIPELINE_STAGES[i].id;
  }
  return PIPELINE_STAGES[0]?.id ?? "discovery";
}

export function stageIndex(stageId: string): number {
  const idx = PIPELINE_STAGES.findIndex((s) => s.id === stageId);
  return Math.max(0, idx);
}

export function firstHitMs(
  timeline: PipelineTimelineEntry[],
  stageId: string,
  boundsStart: number,
  boundsEnd = boundsStart + 60_000,
): number {
  const hit = timeline.find((entry) => {
    if (entry.kind === "cost") return entry.cost.stage === stageId;
    return eventToStage(entry.event) === stageId;
  });
  if (hit) return new Date(hit.ts).getTime();
  const idx = stageIndex(stageId);
  const span = Math.max(boundsEnd - boundsStart, 1000);
  return (
    boundsStart +
    (PIPELINE_STAGES.length > 1 ? idx / (PIPELINE_STAGES.length - 1) : 0) * span
  );
}

export function recentStageFeed(
  timeline: PipelineTimelineEntry[],
  stageId: string,
  upToMs: number | null,
  limit = 6,
): Array<
  | { kind: "event"; ts: string; label: string; detail: string }
  | { kind: "cost"; ts: string; label: string; detail: string; usd: number }
> {
  const items: Array<
    | { kind: "event"; ts: string; label: string; detail: string }
    | { kind: "cost"; ts: string; label: string; detail: string; usd: number }
  > = [];

  for (const entry of sliceTimeline(timeline, upToMs)) {
    if (entry.kind === "cost") {
      if (entry.cost.stage !== stageId) continue;
      items.push({
        kind: "cost",
        ts: entry.ts,
        label: entry.cost.operation,
        detail: entry.cost.provider.replace(/_/g, " "),
        usd: entry.cost.usd,
      });
      continue;
    }
    const stage = eventToStage(entry.event);
    if (stage !== stageId) continue;
    const evt = entry.event;
    items.push({
      kind: "event",
      ts: entry.ts,
      label: evt.event,
      detail:
        (typeof evt.business === "string" && evt.business) ||
        (typeof evt.place_id === "string" && evt.place_id) ||
        (typeof evt.reason === "string" && evt.reason) ||
        stageId,
    });
  }

  return items.slice(-limit).reverse();
}

export function progressiveStageStats(
  costs: PipelineCostEvent[],
  events: JobEvent[],
  upToMs: number | null,
): Map<string, StageStat> {
  const slicedCosts = sliceCosts(costs, upToMs);
  const slicedEvents =
    upToMs == null
      ? events
      : events.filter((e) => new Date(e.ts).getTime() <= upToMs);

  const stats = new Map<string, StageStat>();
  const ensure = (stage: string): StageStat => {
    const existing = stats.get(stage);
    if (existing) return existing;
    const created: StageStat = {
      stage,
      eventCount: 0,
      ranCount: 0,
      usd: 0,
      credits: 0,
      avgDurationMs: null,
      maxDurationMs: null,
    };
    stats.set(stage, created);
    return created;
  };

  const durations = new Map<string, number[]>();

  for (const cost of slicedCosts) {
    const stat = ensure(cost.stage);
    stat.eventCount += 1;
    stat.usd += cost.usd;
    if (cost.provider === "firecrawl") stat.credits += cost.units;
    if (cost.duration_ms != null) {
      const list = durations.get(cost.stage) ?? [];
      list.push(cost.duration_ms);
      durations.set(cost.stage, list);
    }
  }

  for (const evt of slicedEvents) {
    const stage = eventToStage(evt);
    if (!stage) continue;
    const stat = ensure(stage);
    if (evt.event === "stage_done" || evt.ran === true) stat.ranCount += 1;
    if (typeof evt.duration_ms === "number") {
      const list = durations.get(stage) ?? [];
      list.push(evt.duration_ms);
      durations.set(stage, list);
    }
  }

  for (const [stage, list] of durations) {
    const stat = ensure(stage);
    stat.avgDurationMs = list.reduce((a, b) => a + b, 0) / list.length;
    stat.maxDurationMs = Math.max(...list);
  }

  return stats;
}

export function spendGroupsForView(
  costs: PipelineCostEvent[],
  view: "stage" | "provider" | "hits",
): CostGroup[] {
  if (view === "hits") return rollupCosts(costs, 4).slice(0, 24);
  if (view === "provider") return rollupCosts(costs, 1);
  return rollupCosts(costs, 2);
}

export function stageLabel(stageId: string): string {
  const id = canonicalStageId(stageId);
  return PIPELINE_STAGES.find((s) => s.id === id)?.label ?? id.replace(/_/g, " ");
}

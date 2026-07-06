import type { JobEvent } from "@/lib/types";
import type { PipelineCostEvent } from "./stages";

export type Granularity = 0 | 1 | 2 | 3 | 4;

export const GRANULARITY_LABELS: Record<Granularity, string> = {
  0: "Run",
  1: "Provider",
  2: "Stage",
  3: "Operation",
  4: "Tool call",
};

export type CostGroup = {
  key: string;
  label: string;
  usd: number;
  units: number;
  unitType: string;
  eventCount: number;
  avgDurationMs: number | null;
  children?: CostGroup[];
  event?: PipelineCostEvent;
};

export type StageStat = {
  stage: string;
  eventCount: number;
  ranCount: number;
  usd: number;
  credits: number;
  avgDurationMs: number | null;
  maxDurationMs: number | null;
};

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function rollupCosts(events: PipelineCostEvent[], level: Granularity): CostGroup[] {
  if (events.length === 0) return [];

  if (level === 4) {
    return events.map((event) => ({
      key: String(event.id),
      label: `${event.provider}:${event.operation}`,
      usd: event.usd,
      units: event.units,
      unitType: event.unit_type,
      eventCount: 1,
      avgDurationMs: event.duration_ms,
      event,
    }));
  }

  const buckets = new Map<string, PipelineCostEvent[]>();

  for (const event of events) {
    let key: string;
    switch (level) {
      case 0:
        key = "run";
        break;
      case 1:
        key = event.provider;
        break;
      case 2:
        key = event.stage;
        break;
      case 3:
        key = `${event.provider}:${event.operation}${event.model ? `:${event.model}` : ""}`;
        break;
      default: {
        const _exhaustive: never = level;
        return _exhaustive;
      }
    }
    const list = buckets.get(key) ?? [];
    list.push(event);
    buckets.set(key, list);
  }

  return [...buckets.entries()]
    .map(([key, groupEvents]) => {
      const durations = groupEvents
        .map((e) => e.duration_ms)
        .filter((d): d is number => d != null);
      const first = groupEvents[0];
      let label = key;
      if (level === 0) label = "Entire run";
      if (level === 1) label = first.provider;
      if (level === 2) label = first.stage;
      if (level === 3) {
        label = first.model
          ? `${first.operation} (${first.model})`
          : `${first.provider}:${first.operation}`;
      }
      return {
        key,
        label,
        usd: groupEvents.reduce((s, e) => s + e.usd, 0),
        units: groupEvents.reduce((s, e) => s + e.units, 0),
        unitType: first.unit_type,
        eventCount: groupEvents.length,
        avgDurationMs: avg(durations),
      };
    })
    .sort((a, b) => b.usd - a.usd || a.label.localeCompare(b.label));
}

export function stageStats(
  events: PipelineCostEvent[],
  runEvents: JobEvent[],
): Map<string, StageStat> {
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

  const durationsByStage = new Map<string, number[]>();

  for (const event of events) {
    const stat = ensure(event.stage);
    stat.eventCount += 1;
    stat.usd += event.usd;
    if (event.provider === "firecrawl") {
      stat.credits += event.units;
    }
    if (event.duration_ms != null) {
      const list = durationsByStage.get(event.stage) ?? [];
      list.push(event.duration_ms);
      durationsByStage.set(event.stage, list);
    }
  }

  for (const evt of runEvents) {
    const stage = evt.stage ?? evt.event;
    if (!stage) continue;
    const stat = ensure(stage);
    if (evt.event === "stage_done" || evt.ran === true || evt.event === stage) {
      stat.ranCount += 1;
    }
    const dur =
      typeof evt.duration_ms === "number"
        ? evt.duration_ms
        : typeof (evt as Record<string, unknown>).duration_ms === "number"
          ? Number((evt as Record<string, unknown>).duration_ms)
          : null;
    if (dur != null) {
      const list = durationsByStage.get(stage) ?? [];
      list.push(dur);
      durationsByStage.set(stage, list);
    }
  }

  for (const [stage, durations] of durationsByStage) {
    const stat = ensure(stage);
    stat.avgDurationMs = avg(durations);
    stat.maxDurationMs = Math.max(...durations);
  }

  return stats;
}

export function rollupByStage(events: PipelineCostEvent[]): Map<string, CostGroup> {
  const groups = rollupCosts(events, 2);
  return new Map(groups.map((g) => [g.key, g]));
}

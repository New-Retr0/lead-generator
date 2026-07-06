import type { JobEvent } from "@/lib/types";

type RunEventRowLike = {
  id: number;
  run_id: string;
  place_id: string | null;
  stage: string;
  ran: number | boolean;
  reason: string | null;
  credits_est: number | null;
  duration_ms?: number | null;
  meta_json?: unknown;
  created_at: string;
};

function parseMeta(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

export function runEventRowToJobEvent(row: RunEventRowLike): JobEvent {
  const meta = parseMeta(row.meta_json);
  const eventName =
    typeof meta.event === "string" ? meta.event : row.stage;

  const evt: JobEvent = {
    t: "evt",
    ts: typeof meta.ts === "string" ? meta.ts : row.created_at,
    event: eventName,
    run_id: row.run_id,
    stage: row.stage,
    reason: row.reason ?? undefined,
    credits: row.credits_est ?? undefined,
  };

  if (row.place_id) evt.place_id = row.place_id;
  if (typeof meta.business === "string") evt.business = meta.business;
  if (typeof meta.market === "string") evt.market = meta.market;
  if (typeof meta.category === "string") evt.category = meta.category;
  if (typeof meta.verification_level === "string") {
    evt.verification_level = meta.verification_level;
  }
  if (typeof meta.score === "number") evt.score = meta.score;
  if (typeof meta.count === "number") evt.count = meta.count;
  if (typeof meta.discovered === "number") evt.discovered = meta.discovered;
  if (typeof meta.skipped_known === "number") evt.skipped_known = meta.skipped_known;
  if (typeof meta.enriched === "number") evt.enriched = meta.enriched;
  if (typeof meta.kind === "string") evt.kind = meta.kind;
  if (typeof meta.value === "string") evt.value = meta.value;
  if (row.duration_ms != null) evt.duration_ms = row.duration_ms;

  return evt;
}

export function parseLogLineToJobEvent(line: string): JobEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed.t !== "evt" || typeof parsed.event !== "string") return null;
    return parsed as JobEvent;
  } catch {
    return null;
  }
}

export function liveNamesFromEvents(events: JobEvent[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const evt of events) {
    if (evt.place_id && evt.business) {
      names[evt.place_id] = evt.business;
    }
  }
  return names;
}

export function liveDiscoveredFromEvents(events: JobEvent[]): number | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const evt = events[i];
    if (evt.event === "discovery_done" && typeof evt.count === "number") {
      return evt.count;
    }
  }
  return null;
}

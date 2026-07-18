import type { JobEvent } from "@/lib/types";

export type MatrixProgress = {
  started: number;
  done: number;
  currentMarket: string | null;
  currentCategory: string | null;
  latestRunId: string | null;
};

export type JobTotals = {
  leadsStarted: number;
  leadsDone: number;
  credits: number;
  rejected: number;
};

/** Skip empty lines, structured JSON evt echoes, and bare traceback headers. */
function isNoiseLogLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (trimmed === "Traceback (most recent call last):") return true;
  if (trimmed.startsWith("{") && trimmed.includes('"t"') && trimmed.includes('"evt"')) {
    return true;
  }
  return false;
}

function eventLabel(event: JobEvent): string {
  return event.event.replace(/_/g, " ");
}

/** Summarize a structured job event for the operator "now" line. */
export function summarizeJobEvent(event: JobEvent): string {
  const label = eventLabel(event);
  const marketCat = [event.market, event.category].filter(Boolean).join(" / ");

  if (event.event === "run_started" && marketCat) {
    return `Cell started · ${marketCat}`;
  }
  if (event.event === "run_done") {
    const parts: string[] = [];
    if (typeof event.discovered === "number") parts.push(`${event.discovered} discovered`);
    if (typeof event.enriched === "number") parts.push(`${event.enriched} completed`);
    if (typeof event.skipped_known === "number" && event.skipped_known > 0) {
      parts.push(`${event.skipped_known} known`);
    }
    const suffix = parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
    return marketCat ? `Cell done · ${marketCat}${suffix}` : `Cell done${suffix}`;
  }
  if (event.event === "discovery_done" && typeof event.count === "number") {
    const where = marketCat ? ` · ${marketCat}` : "";
    return `${event.count} place(s) discovered${where}`;
  }
  if (event.event === "lead_started" && event.business) {
    return `Researching ${event.business}`;
  }
  if (event.event === "lead_done" && event.business) {
    const level = event.verification_level
      ? ` · ${String(event.verification_level)}`
      : "";
    return `Completed ${event.business}${level}`;
  }
  if (event.event === "lead_failed" && (event.business || event.reason)) {
    return `Failed ${event.business ?? "lead"}${event.reason ? ` · ${event.reason}` : ""}`;
  }
  if (event.event === "verification_rejected") {
    return event.reason
      ? `Rejected · ${event.reason}`
      : event.business
        ? `Rejected · ${event.business}`
        : "Rejected by verification";
  }
  if (event.stage && event.business) {
    return `${event.stage.replace(/_/g, " ")} · ${event.business}`;
  }
  if (event.reason) {
    return `${label} · ${event.reason}`;
  }
  if (marketCat) {
    return `${label} · ${marketCat}`;
  }
  if (event.business) {
    return `${label} · ${event.business}`;
  }
  return label;
}

export function latestRunId(events: JobEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const id = events[i]?.run_id;
    if (typeof id === "string" && id.trim()) return id;
  }
  return null;
}

export function matrixProgress(events: JobEvent[]): MatrixProgress {
  let started = 0;
  let done = 0;
  let currentMarket: string | null = null;
  let currentCategory: string | null = null;

  for (const event of events) {
    if (event.event === "run_started") {
      started += 1;
      if (typeof event.market === "string" && event.market) currentMarket = event.market;
      if (typeof event.category === "string" && event.category) {
        currentCategory = event.category;
      }
    }
    if (event.event === "run_done") {
      done += 1;
    }
    if (event.market && event.event !== "run_done") {
      currentMarket = String(event.market);
    }
    if (event.category && event.event !== "run_done") {
      currentCategory = String(event.category);
    }
  }

  // Prefer the most recent unfinished cell's market/category.
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event) continue;
    if (event.event === "run_done") break;
    if (event.market || event.category) {
      currentMarket = event.market ? String(event.market) : currentMarket;
      currentCategory = event.category ? String(event.category) : currentCategory;
      break;
    }
  }

  return {
    started,
    done,
    currentMarket,
    currentCategory,
    latestRunId: latestRunId(events),
  };
}

export function jobTotals(events: JobEvent[]): JobTotals {
  let leadsStarted = 0;
  let leadsDone = 0;
  let credits = 0;
  let rejected = 0;
  for (const event of events) {
    if (event.event === "lead_started") leadsStarted += 1;
    if (event.event === "lead_done") leadsDone += 1;
    if (event.event === "verification_rejected") rejected += 1;
    if (typeof event.credits === "number" && Number.isFinite(event.credits)) {
      credits += event.credits;
    }
  }
  return { leadsStarted, leadsDone, credits, rejected };
}

/** Last useful raw CLI line (skip empty / pure JSON evt lines). */
export function latestLogLine(lines: string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim() ?? "";
    if (!line || isNoiseLogLine(line)) continue;
    // Strip common log prefixes for readability.
    const cleaned = line
      .replace(/^\d{4}-\d{2}-\d{2}[T ][\d:.,+-Z]+\s*/, "")
      .replace(/^(?:INFO|WARNING|ERROR|DEBUG)\s+[^\s]+\s+(?:—|-)?\s*/, "")
      .trim();
    if (cleaned) return cleaned.length > 160 ? `${cleaned.slice(0, 157)}…` : cleaned;
  }
  return null;
}

/** Last N human-readable CLI lines for a compact terminal strip. */
export function recentLogTail(lines: string[], limit = 5): string[] {
  const out: string[] = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i -= 1) {
    const line = lines[i]?.trim() ?? "";
    if (!line || isNoiseLogLine(line)) continue;
    const cleaned = line
      .replace(/^\d{4}-\d{2}-\d{2}[T ][\d:.,+-Z]+\s*/, "")
      .replace(/^(?:INFO|WARNING|ERROR|DEBUG)\s+[^\s]+\s+(?:—|-)?\s*/, "")
      .trim();
    if (!cleaned) continue;
    out.push(cleaned.length > 200 ? `${cleaned.slice(0, 197)}…` : cleaned);
  }
  return out.reverse();
}

export function nowLine({
  events,
  lines,
  fallback = "Spawning pallares-leads run-campaign…",
}: {
  events: JobEvent[];
  lines: string[];
  fallback?: string;
}): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event) continue;
    if (event.event === "heartbeat") continue;
    return summarizeJobEvent(event);
  }
  return latestLogLine(lines) ?? fallback;
}

export type CampaignCellStatus = "queued" | "running" | "done" | "failed";

export type CampaignCell = {
  key: string;
  market: string;
  category: string;
  status: CampaignCellStatus;
  runId: string | null;
  discovered: number | null;
  completed: number | null;
};

export type CampaignCellStats = {
  total: number;
  queued: number;
  running: number;
  done: number;
  failed: number;
  current: CampaignCell | null;
};

export function cellKey(market: string, category: string): string {
  return `${market}::${category}`;
}

export function formatCellLabel(market: string, category: string): string {
  return `${market.replace(/_/g, " ")} · ${category.replace(/_/g, " ")}`;
}

/**
 * Seed the planned market×category matrix, then overlay run_started / run_done
 * (and failure signals) from the live job event stream.
 */
export function buildCampaignCells({
  markets,
  categories,
  events,
  jobStatus,
}: {
  markets: string[];
  categories: string[];
  events: JobEvent[];
  /** When the parent local job is terminal, flip leftover running cells. */
  jobStatus?: string | null;
}): CampaignCell[] {
  const map = new Map<string, CampaignCell>();
  for (const market of markets) {
    for (const category of categories) {
      const key = cellKey(market, category);
      map.set(key, {
        key,
        market,
        category,
        status: "queued",
        runId: null,
        discovered: null,
        completed: null,
      });
    }
  }

  const byRunId = new Map<string, string>();

  const ensureCell = (market: string, category: string): CampaignCell => {
    const key = cellKey(market, category);
    let cell = map.get(key);
    if (!cell) {
      cell = {
        key,
        market,
        category,
        status: "queued",
        runId: null,
        discovered: null,
        completed: null,
      };
      map.set(key, cell);
    }
    return cell;
  };

  for (const event of events) {
    if (event.event === "run_started") {
      const market = typeof event.market === "string" ? event.market : "";
      const category = typeof event.category === "string" ? event.category : "";
      if (!market || !category) continue;
      const cell = ensureCell(market, category);
      if (cell.status === "queued" || cell.status === "running") {
        cell.status = "running";
      }
      if (typeof event.run_id === "string" && event.run_id) {
        cell.runId = event.run_id;
        byRunId.set(event.run_id, cell.key);
      }
      continue;
    }

    // Soft live signal — if run_started was dropped from a truncated buffer,
    // cell-level events with market+category_key should still light the cell.
    // Do NOT use lead_* category here: those emit human labels (e.g. "Strip Mall"),
    // which would create ghost matrix columns.
    if (
      (event.event === "discovery_done" ||
        event.event === "firecrawl_plan" ||
        event.event === "heartbeat") &&
      typeof event.market === "string" &&
      typeof event.category === "string" &&
      event.market &&
      event.category
    ) {
      const cell = ensureCell(event.market, event.category);
      if (cell.status === "queued") cell.status = "running";
      if (typeof event.run_id === "string" && event.run_id) {
        cell.runId = event.run_id;
        byRunId.set(event.run_id, cell.key);
      }
    }

    // Lead events: only revive a known cell via run_id map (never invent axes).
    if (
      (event.event === "lead_started" ||
        event.event === "lead_done" ||
        event.event === "lead_failed") &&
      typeof event.run_id === "string" &&
      event.run_id &&
      byRunId.has(event.run_id)
    ) {
      const cell = map.get(byRunId.get(event.run_id)!);
      if (cell && cell.status === "queued") cell.status = "running";
    }

    if (event.event === "run_done") {
      const runId = typeof event.run_id === "string" ? event.run_id : null;
      let cell: CampaignCell | undefined;
      if (runId && byRunId.has(runId)) {
        cell = map.get(byRunId.get(runId)!);
      } else if (event.market && event.category) {
        cell = ensureCell(String(event.market), String(event.category));
      }
      if (!cell) continue;
      const failed =
        event.status === "failed" ||
        event.status === "error" ||
        (typeof event.reason === "string" &&
          /exception|error|fail/i.test(event.reason));
      cell.status = failed ? "failed" : "done";
      if (runId) cell.runId = runId;
      if (typeof event.discovered === "number") cell.discovered = event.discovered;
      if (typeof event.enriched === "number") cell.completed = event.enriched;
      continue;
    }

    if (event.event === "run_failed") {
      const runId = typeof event.run_id === "string" ? event.run_id : null;
      let cell: CampaignCell | undefined;
      if (runId && byRunId.has(runId)) {
        cell = map.get(byRunId.get(runId)!);
      } else if (event.market && event.category) {
        cell = ensureCell(String(event.market), String(event.category));
      }
      if (!cell) continue;
      if (cell.status === "queued" || cell.status === "running") {
        cell.status = "failed";
      }
      if (runId) cell.runId = runId;
      continue;
    }

    if (event.event === "lead_failed") {
      // Soft-signaled above when market+category present — never fail the cell
      // from a single lead timeout/error.
      continue;
    }
  }

  const terminalJob =
    jobStatus === "cancelled" ||
    jobStatus === "failed" ||
    jobStatus === "interrupted" ||
    jobStatus === "completed";
  if (terminalJob) {
    for (const cell of map.values()) {
      // Parent finished while a cell still looked live — treat as failed/orphan.
      if (cell.status === "running") cell.status = "failed";
    }
  }

  // Preserve planned order: markets outer, categories inner.
  const ordered: CampaignCell[] = [];
  const seen = new Set<string>();
  for (const market of markets) {
    for (const category of categories) {
      const key = cellKey(market, category);
      const cell = map.get(key);
      if (cell) {
        ordered.push(cell);
        seen.add(key);
      }
    }
  }
  for (const cell of map.values()) {
    if (!seen.has(cell.key)) ordered.push(cell);
  }
  return ordered;
}

export function campaignCellStats(cells: CampaignCell[]): CampaignCellStats {
  let queued = 0;
  let running = 0;
  let done = 0;
  let failed = 0;
  let current: CampaignCell | null = null;
  for (const cell of cells) {
    switch (cell.status) {
      case "queued":
        queued += 1;
        break;
      case "running":
        running += 1;
        if (!current) current = cell;
        break;
      case "done":
        done += 1;
        break;
      case "failed":
        failed += 1;
        break;
      default: {
        const _exhaustive: never = cell.status;
        void _exhaustive;
        break;
      }
    }
  }
  return {
    total: cells.length,
    queued,
    running,
    done,
    failed,
    current,
  };
}

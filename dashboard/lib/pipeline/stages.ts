import type { JobEvent } from "@/lib/types";

export type PipelineProvider =
  | "firecrawl"
  | "browser_use"
  | "google_places"
  | "system";

export type PipelineStageDef = {
  id: string;
  label: string;
  provider: PipelineProvider;
  conditional?: boolean;
  lane: "discovery" | "main" | "fast" | "owner";
  position: { x: number; y: number };
};

/** Canonical enrichment DAG — left-to-right lanes, hand-positioned for React Flow. */
export const PIPELINE_STAGES: PipelineStageDef[] = [
  {
    id: "discovery",
    label: "Discovery",
    provider: "google_places",
    lane: "discovery",
    position: { x: 0, y: 120 },
  },
  {
    id: "lead_started",
    label: "Lead started",
    provider: "system",
    lane: "main",
    position: { x: 180, y: 120 },
  },
  {
    id: "profile_fast_path",
    label: "Fast path",
    provider: "system",
    conditional: true,
    lane: "fast",
    position: { x: 360, y: 0 },
  },
  {
    id: "website_resolve",
    label: "Website",
    provider: "firecrawl",
    lane: "main",
    position: { x: 360, y: 120 },
  },
  {
    id: "map",
    label: "Map",
    provider: "firecrawl",
    lane: "main",
    position: { x: 520, y: 120 },
  },
  {
    id: "scrape",
    label: "Scrape",
    provider: "firecrawl",
    lane: "main",
    position: { x: 680, y: 120 },
  },
  {
    id: "tier2_search",
    label: "Tier-2 search",
    provider: "firecrawl",
    lane: "main",
    position: { x: 840, y: 120 },
  },
  {
    id: "leasing",
    label: "Leasing",
    provider: "firecrawl",
    conditional: true,
    lane: "main",
    position: { x: 1000, y: 120 },
  },
  {
    id: "pdf",
    label: "PDF",
    provider: "firecrawl",
    conditional: true,
    lane: "main",
    position: { x: 1160, y: 120 },
  },
  {
    id: "bbb",
    label: "BBB",
    provider: "firecrawl",
    conditional: true,
    lane: "main",
    position: { x: 1320, y: 120 },
  },
  {
    id: "state_license",
    label: "State license",
    provider: "firecrawl",
    conditional: true,
    lane: "main",
    position: { x: 1480, y: 120 },
  },
  {
    id: "linkedin_serp",
    label: "LinkedIn SERP",
    provider: "firecrawl",
    conditional: true,
    lane: "main",
    position: { x: 1640, y: 120 },
  },
  {
    id: "owner_chain",
    label: "Owner chain",
    provider: "firecrawl",
    lane: "owner",
    position: { x: 1800, y: 200 },
  },
  {
    id: "source_checklist",
    label: "Source checklist",
    provider: "firecrawl",
    conditional: true,
    lane: "main",
    position: { x: 1960, y: 120 },
  },
  {
    id: "lead_done",
    label: "Lead done",
    provider: "system",
    lane: "main",
    position: { x: 2120, y: 120 },
  },
];

export const STAGE_EDGES: { id: string; source: string; target: string; conditional?: boolean }[] = [
  { id: "e-discovery-lead", source: "discovery", target: "lead_started" },
  { id: "e-lead-fast", source: "lead_started", target: "profile_fast_path", conditional: true },
  { id: "e-lead-website", source: "lead_started", target: "website_resolve" },
  { id: "e-website-map", source: "website_resolve", target: "map" },
  { id: "e-map-scrape", source: "map", target: "scrape" },
  { id: "e-scrape-tier2", source: "scrape", target: "tier2_search" },
  { id: "e-tier2-leasing", source: "tier2_search", target: "leasing" },
  { id: "e-leasing-pdf", source: "leasing", target: "pdf" },
  { id: "e-pdf-bbb", source: "pdf", target: "bbb" },
  { id: "e-bbb-license", source: "bbb", target: "state_license" },
  { id: "e-license-linkedin", source: "state_license", target: "linkedin_serp" },
  { id: "e-linkedin-owner", source: "linkedin_serp", target: "owner_chain" },
  { id: "e-owner-checklist", source: "owner_chain", target: "source_checklist" },
  { id: "e-checklist-done", source: "source_checklist", target: "lead_done" },
  { id: "e-fast-done", source: "profile_fast_path", target: "lead_done", conditional: true },
];

/** Map cost_events provider:operation → pipeline stage when meta_json.stage is absent. */
export const STAGE_OPERATION_MAP: Record<string, string> = {
  "google_places:text_search": "discovery",
  "google_places:nearby_search": "discovery",
  "google_places:place_details": "discovery",
  "firecrawl:map": "map",
  "firecrawl:scrape": "scrape",
  "firecrawl:scrape_json": "scrape",
  "firecrawl:batch_scrape": "scrape",
  "firecrawl:scrape_pdf": "pdf",
  "firecrawl:search": "tier2_search",
  "firecrawl:search_contact": "tier2_search",
  "firecrawl:search_website": "website_resolve",
  "firecrawl:agent": "owner_chain",
};

/** Legacy progress / production event stage names. */
const EVENT_STAGE_ALIASES: Record<string, string> = {
  scrape_json: "scrape",
  markdown: "scrape",
  gateway: "scrape",
  firecrawl_agent: "owner_chain",
  final: "lead_done",
  search: "website_resolve",
  search_contact: "tier2_search",
  discovery_done: "discovery",
  run_started: "discovery",
  run_done: "lead_done",
};

const STAGE_IDS = new Set(PIPELINE_STAGES.map((s) => s.id));

export type PipelineCostEvent = {
  id: number;
  usd: number;
  provider: string;
  operation: string;
  model: string | null;
  units: number;
  unit_type: string;
  place_id: string | null;
  created_at: string;
  meta: Record<string, unknown>;
  stage: string;
  duration_ms: number | null;
};

export type PipelineTimelineEntry =
  | { kind: "event"; ts: string; event: JobEvent; duration_ms?: number | null }
  | { kind: "cost"; ts: string; cost: PipelineCostEvent };

export function parseCostMeta(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function resolveAliasStage(raw: string): string | null {
  const aliased = EVENT_STAGE_ALIASES[raw] ?? raw;
  if (STAGE_IDS.has(aliased)) return aliased;
  if (raw.startsWith("source_check:") && STAGE_IDS.has("source_checklist")) {
    return "source_checklist";
  }
  return null;
}

/** Collapse telemetry aliases (`source_check:*`, `scrape_json`, …) to a studio stage id. */
export function canonicalStageId(raw: string): string {
  return resolveAliasStage(raw) ?? raw;
}

/** Terminal place-level stages — a lead with any of these is finished, not in progress. */
const LEAD_FINISHED_STAGES = new Set([
  "lead_done",
  "final",
  "lead_failed",
  "run_done",
  "verification_rejected",
]);

export function isLeadFinishedStage(stage: string | null | undefined): boolean {
  if (!stage) return false;
  const raw = stage.trim();
  if (!raw) return false;
  if (LEAD_FINISHED_STAGES.has(raw)) return true;
  return LEAD_FINISHED_STAGES.has(canonicalStageId(raw));
}

export function timelineLeadIsDone(lead: {
  done?: boolean;
  stages: { stage: string }[];
}): boolean {
  if (lead.done) return true;
  return lead.stages.some((s) => isLeadFinishedStage(s.stage));
}

export function resolveCostStage(
  provider: string,
  operation: string,
  meta: Record<string, unknown>,
): string {
  const fromMeta = meta.stage;
  if (typeof fromMeta === "string") {
    const resolved = resolveAliasStage(fromMeta);
    if (resolved) return resolved;
  }
  const mapped = STAGE_OPERATION_MAP[`${provider}:${operation}`];
  if (mapped) return mapped;
  if (provider === "browser_use") {
    const resolved = resolveAliasStage(operation);
    if (resolved) return resolved;
  }
  return "scrape";
}

export function normalizeCostRow(row: Record<string, unknown>): PipelineCostEvent {
  const meta = parseCostMeta(row.meta_json);
  const provider = String(row.provider);
  const operation = String(row.operation);
  const durationRaw = meta.duration_ms;
  return {
    id: Number(row.id),
    usd: Number(row.usd ?? 0),
    provider,
    operation,
    model: row.model != null ? String(row.model) : null,
    units: Number(row.units ?? 0),
    unit_type: String(row.unit_type ?? row.unitType ?? "units"),
    place_id: row.place_id != null ? String(row.place_id) : null,
    created_at: String(row.created_at),
    meta,
    stage: resolveCostStage(provider, operation, meta),
    duration_ms:
      typeof durationRaw === "number"
        ? durationRaw
        : row.duration_ms != null
          ? Number(row.duration_ms)
          : null,
  };
}

export function getStageDef(stageId: string): PipelineStageDef | undefined {
  return PIPELINE_STAGES.find((s) => s.id === stageId);
}

export function providerColor(provider: PipelineProvider | string): string {
  switch (provider) {
    case "firecrawl":
      return "var(--chart-3)";
    case "browser_use":
      return "var(--chart-2)";
    case "google_places":
      return "var(--chart-1)";
    case "system":
      return "var(--muted-foreground)";
    default:
      return "var(--muted-foreground)";
  }
}

export function eventToStage(event: JobEvent): string | null {
  if (event.stage) {
    const fromStage = resolveAliasStage(event.stage);
    if (fromStage) return fromStage;
  }
  switch (event.event) {
    case "discovery_done":
    case "discovery":
    case "run_started":
      return "discovery";
    case "lead_started":
      return "lead_started";
    case "lead_done":
    case "run_done":
    case "final":
      return "lead_done";
    case "stage_done":
      return event.stage ? resolveAliasStage(event.stage) : null;
    case "map":
      return "map";
    case "scrape_json":
    case "scrape":
    case "markdown":
    case "gateway":
      return "scrape";
    case "search":
      return "website_resolve";
    case "search_contact":
    case "tier2_search":
      return "tier2_search";
    case "firecrawl_agent":
    case "owner_chain":
      return "owner_chain";
    case "profile_fast_path":
      return "profile_fast_path";
    default:
      return event.event ? resolveAliasStage(event.event) : null;
  }
}

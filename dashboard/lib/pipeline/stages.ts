import type { JobEvent } from "@/lib/types";

export type PipelineProvider =
  | "firecrawl"
  | "ai_gateway"
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
    provider: "browser_use",
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
    provider: "browser_use",
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
    id: "sales_copy",
    label: "Sales copy",
    provider: "ai_gateway",
    lane: "main",
    position: { x: 2120, y: 120 },
  },
  {
    id: "lead_done",
    label: "Lead done",
    provider: "system",
    lane: "main",
    position: { x: 2280, y: 120 },
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
  { id: "e-checklist-copy", source: "source_checklist", target: "sales_copy" },
  { id: "e-fast-copy", source: "profile_fast_path", target: "sales_copy", conditional: true },
  { id: "e-copy-done", source: "sales_copy", target: "lead_done" },
];

/** Fallback when cost_events.meta_json.stage is absent (pre-backend migration). */
export const STAGE_OPERATION_MAP: Record<string, string> = {
  "google_places:text_search": "discovery",
  "google_places:nearby_search": "discovery",
  "google_places:place_details": "discovery",
  "firecrawl:map": "map",
  "firecrawl:scrape": "scrape",
  "firecrawl:scrape_pdf": "pdf",
  "firecrawl:search": "tier2_search",
  "firecrawl:search_contact": "tier2_search",
  "firecrawl:search_website": "website_resolve",
  "firecrawl:agent": "owner_chain",
  "ai_gateway:contact_extract": "scrape",
  "ai_gateway:sales_copy": "sales_copy",
  "ai_gateway:chat_completion": "scrape",
  "ai_gateway:planner": "discovery",
  "ai_gateway:owner_disambiguation": "owner_chain",
  "ai_gateway:need_signals": "scrape",
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

export function resolveCostStage(
  provider: string,
  operation: string,
  meta: Record<string, unknown>,
): string {
  const fromMeta = meta.stage;
  if (typeof fromMeta === "string" && STAGE_IDS.has(fromMeta)) {
    return fromMeta;
  }
  const mapped = STAGE_OPERATION_MAP[`${provider}:${operation}`];
  if (mapped) return mapped;
  if (provider === "browser_use" && STAGE_IDS.has(operation)) {
    return operation;
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
    case "ai_gateway":
      return "var(--chart-4)";
    case "browser_use":
      return "var(--chart-2)";
    case "google_places":
      return "var(--chart-1)";
    default:
      return "var(--muted-foreground)";
  }
}

export function eventToStage(event: JobEvent): string | null {
  if (event.stage && STAGE_IDS.has(event.stage)) return event.stage;
  switch (event.event) {
    case "discovery_done":
    case "discovery":
      return "discovery";
    case "lead_started":
      return "lead_started";
    case "run_started":
      return "discovery";
    case "lead_done":
      return "lead_done";
    case "run_done":
      return "lead_done";
    case "stage_done":
      return event.stage ?? null;
    case "map":
      return "map";
    case "scrape_json":
    case "scrape":
      return "scrape";
    case "sales_copy":
      return "sales_copy";
    default:
      return event.stage ?? null;
  }
}

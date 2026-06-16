export const CRM_STATUSES = [
  "New",
  "Contacted",
  "Follow Up",
  "Interested",
  "Quote Sent",
  "Won",
  "Lost",
  "Bad Data",
] as const;
export type CrmStatus = (typeof CRM_STATUSES)[number];
export type LeadType = "client" | "vendor";

export type LeadRow = {
  place_id: string;
  business_name: string;
  market_key: string | null;
  category_key: string | null;
  city: string | null;
  last_enriched_at: string | null;
  enrichment_status: string | null;
  confidence: string | null;
  verification_level: string | null;
  lead_score: number | null;
  status: string;
  crm_status: CrmStatus;
  lead_type: LeadType;
  phone: string | null;
  addressed: boolean;
};

export type SiteContact = {
  name?: string | null;
  role?: string | null;
  phone?: string | null;
  email_or_form?: string | null;
  source_url?: string | null;
  verification?: string | null;
  quote?: string | null;
};

export type LeadFact = {
  fact_kind: string;
  value: Record<string, string>;
  source_kind: string;
  source_url: string;
  method: string;
  quote: string;
  verification: string;
  observed_at: string;
};

export type LeadCostBilling = "verified" | "estimated";

export type LeadCostEvent = {
  id: number;
  runId: string | null;
  requestId: string | null;
  provider: string;
  operation: string;
  units: number;
  unitType: string;
  usd: number;
  model: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
  billing: LeadCostBilling;
};

export type LeadCostByProvider = {
  provider: string;
  usdTotal: number;
  unitsTotal: number;
  unitType: string;
  eventCount: number;
  verifiedUsd: number;
  estimatedUsd: number;
  events: LeadCostEvent[];
};

export type LeadCosts = {
  totalUsd: number;
  verifiedUsd: number;
  estimatedUsd: number;
  firecrawlCreditsEst: number;
  eventCount: number;
  byProvider: LeadCostByProvider[];
  events: LeadCostEvent[];
};

export type LeadDetail = LeadRow & {
  address: string | null;
  website: string | null;
  google_maps_url: string | null;
  best_contact_name: string | null;
  best_contact_role: string | null;
  best_contact_phone: string | null;
  best_contact_email_or_form: string | null;
  property_manager_clue: string | null;
  why_good_fit: string | null;
  why_now: string | null;
  score_breakdown: Record<string, number>;
  talking_points: string | null;
  need_signals: string | null;
  site_contacts: SiteContact[];
  facts: LeadFact[];
  evidence_urls: string[];
  notes: string | null;
  related: RelatedLead[];
  source_checks: SourceCheck[];
  costs: LeadCosts;
};

export type RelatedLead = {
  place_id: string;
  business_name: string;
  city: string | null;
  relation: string;
  detail?: string;
};

export type SourceCheck = {
  source_key: string;
  status: string;
  url?: string;
  reason?: string;
};

export type JobEvent = {
  t: "evt";
  ts: string;
  event: string;
  run_id?: string;
  market?: string;
  category?: string;
  place_id?: string;
  business?: string;
  stage?: string;
  status?: string;
  credits?: number;
  reason?: string;
  verification_level?: string;
  score?: number;
  kind?: string;
  value?: string;
  [key: string]: unknown;
};

export type RunEventRow = {
  id: number;
  run_id: string;
  place_id: string | null;
  stage: string;
  ran: number;
  reason: string | null;
  credits_est: number | null;
  created_at: string;
};

export type ProviderBalance = {
  provider: string;
  remaining: number | null;
  used: number | null;
  plan: number | null;
  unitLabel: string;
  snapshotAt: string | null;
};

export type OverviewStats = {
  totalLeads: number;
  enrichedLeads: number;
  readyToCall: number;
  readyToCallRate: number;
  creditsThisMonth: number;
  browserUseUsdThisMonth: number;
  aiGatewayUsdThisMonth: number;
  usdByProvider: {
    provider: string;
    usd: number;
    units: number;
    unitType: string;
  }[];
  balances: ProviderBalance[];
};

export type CostDayRow = {
  date: string;
  usd: number;
  firecrawlCredits: number;
  browserUseUsd: number;
  aiGatewayUsd: number;
  googlePlacesUsd: number;
};

export type CostSeries = {
  byDay: CostDayRow[];
  byProvider: {
    provider: string;
    usd: number;
    units: number;
    unitType: string;
    count: number;
  }[];
  byOperation: {
    provider: string;
    operation: string;
    usd: number;
    count: number;
    unitType: string;
  }[];
  balances: ProviderBalance[];
};

export type RunRow = {
  run_id: string;
  started_at: string;
  finished_at: string | null;
  run_type: string;
  market_key: string | null;
  category_key: string | null;
  discovered_count: number;
  skipped_known_count: number;
  enriched_count: number;
  status: string;
};

export type RunCostOperation = {
  operation: string;
  usd: number;
  units: number;
  unitType: string;
  count: number;
  billing: LeadCostBilling;
};

export type RunCostProvider = {
  provider: string;
  usdTotal: number;
  unitsTotal: number;
  unitType: string;
  eventCount: number;
  verifiedUsd: number;
  estimatedUsd: number;
  operations: RunCostOperation[];
};

/** Aggregated cost for an entire run (all leads), keyed off cost_events.run_id. */
export type RunCosts = {
  totalUsd: number;
  verifiedUsd: number;
  estimatedUsd: number;
  firecrawlCreditsEst: number;
  eventCount: number;
  leadCount: number;
  byProvider: RunCostProvider[];
};

export type RunTimelineStage = {
  stage: string;
  ran: boolean;
  reason: string | null;
  credits_est: number | null;
  created_at: string;
};

export type RunTimelineLead = {
  place_id: string;
  business_name: string | null;
  category_key: string | null;
  verification_level: string | null;
  lead_score: number | null;
  creditsEst: number;
  /** True once the lead's `final` stage is recorded (enrichment finished). */
  done: boolean;
  stages: RunTimelineStage[];
};

export type RunTimeline = {
  runEvents: RunTimelineStage[];
  leads: RunTimelineLead[];
};

export type RunDetail = {
  run: RunRow;
  costs: RunCosts;
  timeline: RunTimeline;
};

export type RequestRow = {
  request_id: string;
  created_at: string;
  raw_prompt: string;
  status: string;
  leads_delivered: number;
  credits_spent: number;
  usd_spent: number | null;
  spec: Record<string, unknown>;
};

export type JobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "cancelled";

export type JobRecord = {
  id: string;
  kind: "run" | "request" | "export" | "doctor";
  status: JobStatus;
  command: string;
  args: string[];
  logs: string[];
  events: JobEvent[];
  exitCode: number | null;
  pid: number | null;
  createdAt: string;
  finishedAt: string | null;
};

export type MarketOption = {
  key: string;
  city: string;
  state: string;
  county: string | null;
};

export type CategoryOption = {
  key: string;
  label: string;
  recurring: boolean;
  ownerChain: boolean;
  source: string;
};

export type CampaignOption = {
  key: string;
  markets: string[];
  categories: string[];
};

export type PipelineConfig = {
  markets: MarketOption[];
  categories: CategoryOption[];
  campaigns: CampaignOption[];
};

/** Mirrors LeadRequestSpec on the Python side. */
export type RequestSpec = {
  target_kind: "property" | "vendor";
  count: number;
  categories: string[];
  market_keys: string[];
  corridor: { road_ref: string; buffer_m: number } | null;
  require_decision_maker: boolean;
  recurring_only: boolean;
  min_lead_score: number;
  budget: { max_firecrawl_credits: number; max_usd: number };
  needs_confirmation: string[];
};

/** Mirrors estimate_request_cost() in request/planner.py. */
export function estimateRequestCost(spec: {
  count: number;
  categories: string[];
  market_keys: string[];
  budget: { max_firecrawl_credits: number; max_usd: number };
}): {
  discoveryCredits: number;
  enrichCredits: number;
  totalCredits: number;
  usd: number;
} {
  const perLeadCredits = 13;
  const creditUsd = 0.00533;
  const discoveryCredits = spec.categories.length * spec.market_keys.length * 2;
  const enrichCredits = spec.count * perLeadCredits;
  const total = discoveryCredits + enrichCredits;
  return {
    discoveryCredits,
    enrichCredits,
    totalCredits: Math.min(total, spec.budget.max_firecrawl_credits),
    usd: Math.min(total * creditUsd, spec.budget.max_usd),
  };
}

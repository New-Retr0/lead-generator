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
  best_contact_name: string | null;
  best_contact_role: string | null;
  /** Populated only in the "dud" inventory view — why the lead was rejected. */
  dud_reason?: string | null;
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
  why_now: string | null;
  score_breakdown: Record<string, number>;
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
  id?: number | string;
  t: "evt";
  ts: string;
  event: string;
  /** SSE resume cursor (sequence within the job log stream). */
  _seq?: number;
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
  duration_ms: number | null;
  meta_json: unknown;
  created_at: string;
};

export type ProviderBalance = {
  provider: string;
  remaining: number | null;
  used: number | null;
  plan: number | null;
  planName?: string | null;
  creditUsd?: number | null;
  billingPeriodEnd: string | null;
  unitLabel: string;
  snapshotAt: string | null;
};

export type FirecrawlPlan = {
  key: string;
  name: string;
  monthlyCredits: number;
  monthlyUsd: number;
  billing: string | null;
  concurrentBrowsers: number;
  maxQueuedJobs: number;
  rateLimitsRpm: {
    scrape: number;
    map: number;
    crawl: number;
    search: number;
    agent: number;
  };
};

export type CostBudget = {
  planCredits: number;
  remainingCredits: number | null;
  usedThisCycle: number | null;
  billingPeriodEnd: string | null;
  dailyAverageCredits: number | null;
  projectedCycleCredits: number | null;
  projectedOverPlan: boolean;
  percentOfPlanUsed: number | null;
  planTier: string | null;
  planName: string | null;
  creditUsd: number | null;
};

export type CostByRunRow = {
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  runType: string;
  marketKey: string | null;
  categoryKey: string | null;
  enrichedCount: number;
  status: string;
  usd: number;
  firecrawlCredits: number;
  eventCount: number;
  usdPerEnrichedLead: number | null;
};

export type CostByModelRow = {
  provider: string;
  model: string;
  operation: string;
  unitType: string;
  units: number;
  usd: number;
  eventCount: number;
};

export type CostByMarketRow = {
  marketKey: string | null;
  categoryKey: string | null;
  usd: number;
  firecrawlCredits: number;
  runCount: number;
  eventCount: number;
};

export type CostByHourRow = {
  hour: string;
  usd: number;
  firecrawlCredits: number;
  eventCount: number;
};

export type YieldSummary = {
  discovered: number;
  enriched: number;
  verifiedDm: number;
};

export type { InventoryMode } from "@/lib/lead-labels";
// Re-export for existing imports; canonical definition lives in lead-labels.

export type OverviewStats = {
  totalLeads: number;
  enrichedLeads: number;
  readyToCall: number;
  readyToCallRate: number;
  partialInventory: number;
  verifiedThisMonth: number;
  creditsThisMonth: number;
  creditsPerVerifiedDm: number | null;
  /** Set when credits/DM falls back to month-wide Firecrawl sum (no place attribution). */
  creditsPerVerifiedDmCaveat: string | null;
  usdThisMonth: number;
  usdPerVerifiedDm: number | null;
  minutesPerVerifiedDm: number | null;
  browserUseUsdThisMonth: number;
  /** Inventory yield: discovered / researched / verified DM (no separate event store). */
  yield: YieldSummary;
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
  byRun: CostByRunRow[];
  byModel: CostByModelRow[];
  byMarket: CostByMarketRow[];
  byHour: CostByHourRow[];
  budget: CostBudget | null;
  balances: ProviderBalance[];
};

export type RunRow = {
  run_id: string;
  started_at: string;
  finished_at: string | null;
  run_type: string;
  market_key: string | null;
  category_key: string | null;
  campaign_key: string | null;
  /** Parent local dashboard job id (PALLARES_JOB_ID), when launched from Launch. */
  job_id: string | null;
  discovered_count: number;
  skipped_known_count: number;
  enriched_count: number;
  status: string;
  /** Why the run stopped early (credit cap, cancel, etc.). Null when unset. */
  stop_reason: string | null;
  stop_detail: string | null;
  /** Full traceback / error text when status=failed. */
  error: string | null;
  verified_dm_count: number | null;
  duration_ms: number | null;
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
  /** True once the lead's `final` stage is recorded (research finished). */
  done: boolean;
  stages: RunTimelineStage[];
};

export type RunTimeline = {
  runEvents: RunTimelineStage[];
  leads: RunTimelineLead[];
};

/** Raw cost row for Pipeline Studio (matches /api/runs/[id]/costs). */
export type RunStudioCostRow = {
  id: number;
  provider: string;
  operation: string;
  units: number;
  unit_type: string;
  usd: number;
  place_id: string | null;
  model: string | null;
  meta_json: unknown;
  created_at: string;
};

export type RunDetail = {
  run: RunRow;
  costs: RunCosts;
  timeline: RunTimeline;
  /** Full ledgers for Pipeline Studio — same source as timeline/costs APIs. */
  studioEvents: RunEventRow[];
  studioCosts: RunStudioCostRow[];
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

export type JobExecutionMode = "local" | "worker";

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
  /** Dashboard spawn path today is always local; worker is reserved for pgmq. */
  executionMode?: JobExecutionMode;
  /** True when the child predates this server process (recovered after restart). */
  detached?: boolean;
  /** Byte offset into `data/jobs/<id>.log` already ingested into logs/events. */
  logByteOffset?: number;
  /** Sequence of `logs[0]` after ring-buffer trims (persisted for SSE resume). */
  firstSeq?: number;
};

/** JobRecord minus logs/events — cheap enough for the poll path. */
export type JobSummary = Omit<JobRecord, "logs" | "events"> & {
  runId: string | null;
  market: string | null;
  category: string | null;
  executionMode: JobExecutionMode;
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
  budget: { max_firecrawl_credits: number };
  needs_confirmation: string[];
};

export const OUTCOME_VALUES = [
  "won",
  "lost",
  "bad_data",
  "unqualified",
  "no_response",
] as const;
export type LeadOutcomeValue = (typeof OUTCOME_VALUES)[number];

export const OUTCOME_REASONS = [
  "wrong_number",
  "no_answer_ever",
  "gatekeeper_block",
  "not_decision_maker",
  "no_budget",
  "competitor",
  "timing",
  "price",
  "invalid_business",
  "duplicate",
  "other",
] as const;
export type OutcomeReason = (typeof OUTCOME_REASONS)[number];

export const TOUCH_TYPES = ["call", "email", "sms", "visit", "other"] as const;
export type TouchType = (typeof TOUCH_TYPES)[number];

export const TOUCH_RESULTS = [
  "answered",
  "voicemail",
  "no_answer",
  "wrong_number",
  "disconnected",
  "gatekeeper",
  "dm_reached",
  "email_sent",
  "email_bounced",
  "email_replied",
  "other",
] as const;
export type TouchResult = (typeof TOUCH_RESULTS)[number];

export type LeadOutcome = {
  place_id: string;
  outcome: LeadOutcomeValue;
  outcome_reason: OutcomeReason | null;
  deal_value_usd: number | null;
  quality_rating: number | null;
  data_flags: Record<string, boolean>;
  source: string;
  notes: string | null;
  decided_at: string;
};

export type LeadTouch = {
  id: number;
  place_id: string;
  touch_type: TouchType;
  result: TouchResult | null;
  contact_name: string | null;
  contact_phone: string | null;
  duration_seconds: number | null;
  source: string;
  notes: string | null;
  occurred_at: string;
};

export type LeadOutcomeInput = {
  outcome: LeadOutcomeValue;
  outcome_reason?: OutcomeReason | null;
  deal_value_usd?: number | null;
  quality_rating?: number | null;
  data_flags?: Record<string, boolean>;
  notes?: string | null;
};

export type LeadTouchInput = {
  touch_type: TouchType;
  result?: TouchResult | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  duration_seconds?: number | null;
  notes?: string | null;
  occurred_at?: string | null;
};

/** Mirrors estimate_request_cost() in request/planner.py. */
export function estimateRequestCost(spec: {
  count: number;
  categories: string[];
  market_keys: string[];
}, creditUsd = 0.00083): {
  discoveryCredits: number;
  enrichCredits: number;
  totalCredits: number;
  usd: number;
} {
  const perLeadCredits = 13;
  const discoveryCredits = spec.categories.length * spec.market_keys.length * 2;
  const enrichCredits = spec.count * perLeadCredits;
  const total = discoveryCredits + enrichCredits;
  return {
    discoveryCredits,
    enrichCredits,
    totalCredits: total,
    usd: total * creditUsd,
  };
}

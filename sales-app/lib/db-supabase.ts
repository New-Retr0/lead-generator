import { createClient } from "@/lib/supabase/server";
import {
  crmStatusFromFeedback,
  isReadyToCall,
  leadTypeFromCategory,
  normalizeListText,
  parseEnrichedJson,
  presentOrNull,
  primaryPhone,
  salesStatus,
  toIso,
  toIsoOrNull,
  type EnrichedJson,
} from "./db-helpers";
import type {
  CostSeries,
  CrmStatus,
  LeadCostBilling,
  LeadCostByProvider,
  LeadCostEvent,
  LeadCosts,
  LeadDetail,
  LeadRow,
  LeadType,
  OverviewStats,
  ProviderBalance,
  RelatedLead,
  RequestRow,
  RunCosts,
  RunDetail,
  RunEventRow,
  RunRow,
  RunTimeline,
  RunTimelineLead,
  RunTimelineStage,
  SiteContact,
  SourceCheck,
} from "./types";

async function supabase() {
  return createClient();
}

function throwOnError(error: { message: string } | null, context: string): void {
  if (error) throw new Error(`${context}: ${error.message}`);
}

function emptyOverview(): OverviewStats {
  return {
    totalLeads: 0,
    enrichedLeads: 0,
    readyToCall: 0,
    readyToCallRate: 0,
    creditsThisMonth: 0,
    browserUseUsdThisMonth: 0,
    aiGatewayUsdThisMonth: 0,
    usdByProvider: [],
    balances: [],
  };
}

function balanceUnitLabel(provider: string): string {
  if (provider === "firecrawl") return "credits";
  if (provider === "browser_use") return "USD";
  return "units";
}

function snapshotPayload(snapshotJson: unknown): Record<string, unknown> | null {
  if (snapshotJson == null) return null;
  if (typeof snapshotJson === "object" && !Array.isArray(snapshotJson)) {
    return snapshotJson as Record<string, unknown>;
  }
  if (typeof snapshotJson === "string") {
    try {
      const parsed = JSON.parse(snapshotJson) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

function parseFirecrawlSnapshotBalance(
  snapshotJson: unknown,
  remaining: number | null,
  used: number | null,
): { remaining: number | null; used: number | null; plan: number | null } {
  const payload = snapshotPayload(snapshotJson);
  let plan: number | null = null;
  let snapRemaining: number | null = null;
  let snapUsed: number | null = null;

  if (payload) {
    try {
      const data =
        payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
          ? (payload.data as Record<string, unknown>)
          : payload;
      const planRaw = data.planCredits ?? data.plan_credits;
      plan = planRaw != null ? Number(planRaw) : null;
      const remRaw = data.remainingCredits ?? data.remaining_credits;
      snapRemaining = remRaw != null ? Number(remRaw) : null;
      let usedRaw = data.usedCredits ?? data.used_credits;
      if (usedRaw == null && snapRemaining != null && plan != null) {
        usedRaw = plan - snapRemaining;
      }
      snapUsed = usedRaw != null ? Number(usedRaw) : null;
    } catch {
      // fall through with DB columns only
    }
  }

  return {
    remaining: remaining ?? snapRemaining,
    used: used ?? snapUsed,
    plan,
  };
}

function parseCostMeta(raw: unknown): Record<string, unknown> {
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

const FIRECRAWL_ESTIMATE_OPS = new Set([
  "map",
  "search",
  "search_contact",
  "search_website",
]);

function classifyCostBilling(
  provider: string,
  operation: string,
  meta: Record<string, unknown>,
): LeadCostBilling {
  if (provider === "browser_use") return "verified";
  if (provider === "ai_gateway" && typeof meta.prompt_tokens === "number") {
    return "verified";
  }
  if (provider === "firecrawl" && FIRECRAWL_ESTIMATE_OPS.has(operation)) {
    return "estimated";
  }
  return "verified";
}

export async function getCreditBalances(): Promise<ProviderBalance[]> {
  const client = await supabase();
  const { data, error } = await client
    .from("credit_snapshots")
    .select("provider, remaining_credits, used_credits, snapshot_json, created_at")
    .order("created_at", { ascending: false });
  throwOnError(error, "credit_snapshots");

  const seen = new Set<string>();
  const rows: ProviderBalance[] = [];
  for (const row of data ?? []) {
    const provider = String(row.provider);
    if (seen.has(provider)) continue;
    seen.add(provider);
    const parsed =
      provider === "firecrawl"
        ? parseFirecrawlSnapshotBalance(
            row.snapshot_json,
            row.remaining_credits as number | null,
            row.used_credits as number | null,
          )
        : {
            remaining: row.remaining_credits as number | null,
            used: row.used_credits as number | null,
            plan: null,
          };
    rows.push({
      provider,
      remaining: parsed.remaining,
      used: parsed.used,
      plan: parsed.plan,
      unitLabel: balanceUnitLabel(provider),
      snapshotAt: toIsoOrNull(row.created_at),
    });
  }
  return rows;
}

export async function getOverview(): Promise<OverviewStats> {
  const client = await supabase();

  const { count: totalLeads, error: totalErr } = await client
    .from("leads")
    .select("*", { count: "exact", head: true });
  throwOnError(totalErr, "leads count");

  const { count: enrichedLeads, error: enrichedErr } = await client
    .from("leads")
    .select("*", { count: "exact", head: true })
    .not("enriched_json", "is", null);
  throwOnError(enrichedErr, "enriched leads count");

  const { data: enrichedRows, error: enrichedRowsErr } = await client
    .from("leads")
    .select("enriched_json")
    .not("enriched_json", "is", null);
  throwOnError(enrichedRowsErr, "enriched leads");

  let readyToCall = 0;
  for (const row of enrichedRows ?? []) {
    if (isReadyToCall(parseEnrichedJson(row.enriched_json))) readyToCall += 1;
  }

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthIso = monthStart.toISOString();

  const { data: costRows, error: costErr } = await client
    .from("cost_events")
    .select("provider, operation, units, unit_type, usd, meta_json, created_at")
    .gte("created_at", monthIso);
  throwOnError(costErr, "cost_events");

  let creditsThisMonth = 0;
  let browserUseUsdThisMonth = 0;
  let aiGatewayUsdThisMonth = 0;
  const merged = new Map<string, OverviewStats["usdByProvider"][number]>();

  for (const row of costRows ?? []) {
    const provider = String(row.provider);
    const usd = Number(row.usd ?? 0);
    const units = Number(row.units ?? 0);
    if (provider === "firecrawl") creditsThisMonth += units;
    if (provider === "browser_use") browserUseUsdThisMonth += usd;
    if (provider === "ai_gateway") aiGatewayUsdThisMonth += usd;

    const existing = merged.get(provider);
    if (existing) {
      existing.usd += usd;
      existing.units += units;
    } else {
      merged.set(provider, {
        provider,
        usd,
        units,
        unitType: String(row.unit_type),
      });
    }
  }

  const total = totalLeads ?? 0;
  const enriched = enrichedLeads ?? 0;

  return {
    totalLeads: total,
    enrichedLeads: enriched,
    readyToCall,
    readyToCallRate: enriched > 0 ? readyToCall / enriched : 0,
    creditsThisMonth,
    browserUseUsdThisMonth,
    aiGatewayUsdThisMonth,
    usdByProvider: [...merged.values()].sort((a, b) => b.usd - a.usd),
    balances: await getCreditBalances(),
  };
}

export async function listLeads(filters?: {
  market?: string;
  category?: string;
  status?: string;
  crmStatus?: string;
  type?: string;
  minScore?: number;
  dudsOnly?: boolean;
  limit?: number;
}): Promise<LeadRow[]> {
  const client = await supabase();
  const limit = filters?.limit ?? 500;

  let query = client
    .from("leads")
    .select(
      "place_id, business_name, market_key, category_key, city, last_enriched_at, enrichment_status, confidence, lead_score, enriched_json, sales_feedback ( status )",
    )
    .not("enriched_json", "is", null)
    .order("lead_score", { ascending: false, nullsFirst: false })
    .order("last_enriched_at", { ascending: false })
    .limit(limit);

  if (filters?.market) query = query.eq("market_key", filters.market);
  if (filters?.category) query = query.eq("category_key", filters.category);
  if (filters?.minScore !== undefined) query = query.gte("lead_score", filters.minScore);
  if (filters?.dudsOnly) {
    query = query.or(
      "lead_score.lt.40,enrichment_status.eq.needs_manual,confidence.eq.Low,enrichment_status.eq.unverified",
    );
  }

  const { data, error } = await query;
  throwOnError(error, "leads");

  const leads: LeadRow[] = [];
  for (const row of data ?? []) {
    const dataJson = parseEnrichedJson(row.enriched_json);
    const status = salesStatus(dataJson);
    if (filters?.status && status !== filters.status) continue;
    const crmStatus = crmStatusFromFeedback(
      row.sales_feedback as { status?: string } | { status?: string }[] | null,
    );
    if (filters?.crmStatus && crmStatus !== filters.crmStatus) continue;
    const categoryKey = (row.category_key as string | null) ?? null;
    const leadType = leadTypeFromCategory(categoryKey);
    if (filters?.type && leadType !== filters.type) continue;
    leads.push({
      place_id: String(row.place_id),
      business_name: String(row.business_name),
      market_key: (row.market_key as string | null) ?? null,
      category_key: categoryKey,
      city: (row.city as string | null) ?? null,
      last_enriched_at: toIsoOrNull(row.last_enriched_at),
      enrichment_status: (row.enrichment_status as string | null) ?? null,
      confidence: (row.confidence as string | null) ?? null,
      verification_level:
        typeof dataJson.verification_level === "string" ? dataJson.verification_level : null,
      lead_score: (row.lead_score as number | null) ?? null,
      status,
      crm_status: crmStatus,
      lead_type: leadType,
      phone: primaryPhone(dataJson),
    });
  }
  return leads;
}

export async function listFilterOptions(): Promise<{
  markets: string[];
  categories: string[];
}> {
  const client = await supabase();
  const { data, error } = await client
    .from("leads")
    .select("market_key, category_key")
    .not("enriched_json", "is", null);
  throwOnError(error, "filter options");

  const markets = new Set<string>();
  const categories = new Set<string>();
  for (const row of data ?? []) {
    if (row.market_key) markets.add(String(row.market_key));
    if (row.category_key) categories.add(String(row.category_key));
  }
  return {
    markets: [...markets].sort(),
    categories: [...categories].sort(),
  };
}

export async function listRuns(limit = 50): Promise<RunRow[]> {
  const client = await supabase();
  const { data, error } = await client
    .from("runs")
    .select(
      "run_id, started_at, finished_at, run_type, market_key, category_key, discovered_count, skipped_known_count, enriched_count, status",
    )
    .order("started_at", { ascending: false })
    .limit(limit);
  throwOnError(error, "runs");

  return (data ?? []).map((row) => ({
    run_id: String(row.run_id),
    started_at: toIso(row.started_at),
    finished_at: toIsoOrNull(row.finished_at),
    run_type: String(row.run_type),
    market_key: (row.market_key as string | null) ?? null,
    category_key: (row.category_key as string | null) ?? null,
    discovered_count: Number(row.discovered_count),
    skipped_known_count: Number(row.skipped_known_count),
    enriched_count: Number(row.enriched_count),
    status: String(row.status),
  }));
}

function parseSpecJson(raw: unknown): Record<string, unknown> {
  if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

export async function listRequests(limit = 50): Promise<RequestRow[]> {
  const client = await supabase();
  const { data, error } = await client
    .from("lead_requests")
    .select(
      "request_id, created_at, raw_prompt, spec_json, status, leads_delivered, credits_spent, usd_spent",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  throwOnError(error, "lead_requests");

  return (data ?? []).map((row) => ({
    request_id: String(row.request_id),
    created_at: toIso(row.created_at),
    raw_prompt: String(row.raw_prompt),
    status: String(row.status),
    leads_delivered: Number(row.leads_delivered),
    credits_spent: Number(row.credits_spent),
    usd_spent: row.usd_spent != null ? Number(row.usd_spent) : null,
    spec: parseSpecJson(row.spec_json),
  }));
}

export async function getCostSeries(days = 30): Promise<CostSeries> {
  const client = await supabase();
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceDate = since.toISOString().slice(0, 10);
  const sinceIso = since.toISOString();

  const { data: byDayRows, error: dayErr } = await client
    .from("cost_by_day")
    .select(
      "date, usd, firecrawl_credits, browser_use_usd, ai_gateway_usd, google_places_usd",
    )
    .gte("date", sinceDate)
    .order("date");
  throwOnError(dayErr, "cost_by_day");

  const { data: providerRows, error: providerErr } = await client
    .from("cost_by_provider")
    .select("provider, unit_type, usd, units, event_count");
  throwOnError(providerErr, "cost_by_provider");

  const mergedProviders = new Map<string, CostSeries["byProvider"][number]>();
  for (const row of providerRows ?? []) {
    const provider = String(row.provider);
    const existing = mergedProviders.get(provider);
    const usd = Number(row.usd);
    const units = Number(row.units);
    const count = Number(row.event_count);
    if (existing) {
      existing.usd += usd;
      existing.units += units;
      existing.count += count;
    } else {
      mergedProviders.set(provider, {
        provider,
        usd,
        units,
        unitType: String(row.unit_type),
        count,
      });
    }
  }

  const { data: opRows, error: opErr } = await client
    .from("cost_events")
    .select("provider, operation, unit_type, usd, created_at")
    .gte("created_at", sinceIso);
  throwOnError(opErr, "cost_events operations");

  const opMap = new Map<string, CostSeries["byOperation"][number]>();
  for (const row of opRows ?? []) {
    const key = `${row.provider}:${row.operation}:${row.unit_type}`;
    const usd = Number(row.usd ?? 0);
    const existing = opMap.get(key);
    if (existing) {
      existing.usd += usd;
      existing.count += 1;
    } else {
      opMap.set(key, {
        provider: String(row.provider),
        operation: String(row.operation),
        usd,
        count: 1,
        unitType: String(row.unit_type),
      });
    }
  }

  return {
    byDay: (byDayRows ?? []).map((row) => ({
      date: String(row.date),
      usd: Number(row.usd),
      firecrawlCredits: Number(row.firecrawl_credits),
      browserUseUsd: Number(row.browser_use_usd),
      aiGatewayUsd: Number(row.ai_gateway_usd),
      googlePlacesUsd: Number(row.google_places_usd),
    })),
    byProvider: [...mergedProviders.values()].sort((a, b) => b.usd - a.usd),
    byOperation: [...opMap.values()].sort((a, b) => b.usd - a.usd).slice(0, 20),
    balances: await getCreditBalances(),
  };
}

function mapRunEventRow(row: Record<string, unknown>): RunEventRow {
  return {
    id: Number(row.id),
    run_id: String(row.run_id),
    place_id: row.place_id != null ? String(row.place_id) : null,
    stage: String(row.stage),
    ran: row.ran ? 1 : 0,
    reason: row.reason != null ? String(row.reason) : null,
    credits_est: row.credits_est != null ? Number(row.credits_est) : null,
    created_at: toIso(row.created_at),
  };
}

export async function getRunEvents(runId: string): Promise<RunEventRow[]> {
  const client = await supabase();
  const { data, error } = await client
    .from("run_events")
    .select("id, run_id, place_id, stage, ran, reason, credits_est, created_at")
    .eq("run_id", runId)
    .order("created_at", { ascending: true });
  throwOnError(error, "run_events");
  return (data ?? []).map((row) => mapRunEventRow(row as Record<string, unknown>));
}

export async function getRun(runId: string): Promise<RunRow | null> {
  const client = await supabase();
  const { data, error } = await client
    .from("runs")
    .select(
      "run_id, started_at, finished_at, run_type, market_key, category_key, discovered_count, skipped_known_count, enriched_count, status",
    )
    .eq("run_id", runId)
    .maybeSingle();
  throwOnError(error, "runs");
  if (!data) return null;
  return {
    run_id: String(data.run_id),
    started_at: toIso(data.started_at),
    finished_at: toIsoOrNull(data.finished_at),
    run_type: String(data.run_type),
    market_key: (data.market_key as string | null) ?? null,
    category_key: (data.category_key as string | null) ?? null,
    discovered_count: Number(data.discovered_count),
    skipped_known_count: Number(data.skipped_known_count),
    enriched_count: Number(data.enriched_count),
    status: String(data.status),
  };
}

function emptyLeadCosts(): LeadCosts {
  return {
    totalUsd: 0,
    verifiedUsd: 0,
    estimatedUsd: 0,
    firecrawlCreditsEst: 0,
    eventCount: 0,
    byProvider: [],
    events: [],
  };
}

export async function getLeadCosts(placeId: string): Promise<LeadCosts> {
  const client = await supabase();
  const { data: rows, error } = await client
    .from("cost_events")
    .select(
      "id, run_id, request_id, provider, operation, units, unit_type, usd, model, meta_json, created_at",
    )
    .eq("place_id", placeId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  throwOnError(error, "lead cost_events");

  const { data: creditsRows, error: creditsErr } = await client
    .from("run_events")
    .select("credits_est")
    .eq("place_id", placeId);
  throwOnError(creditsErr, "lead run_events credits");
  const firecrawlCreditsEst = (creditsRows ?? []).reduce(
    (sum, row) => sum + Number(row.credits_est ?? 0),
    0,
  );

  if (!rows?.length) {
    return { ...emptyLeadCosts(), firecrawlCreditsEst };
  }

  const events: LeadCostEvent[] = [];
  let totalUsd = 0;
  let verifiedUsd = 0;
  let estimatedUsd = 0;
  const providerBuckets = new Map<string, LeadCostByProvider>();

  for (const row of rows) {
    const meta = parseCostMeta(row.meta_json);
    const usd = row.usd != null ? Number(row.usd) : 0;
    const provider = String(row.provider);
    const operation = String(row.operation);
    const billing = classifyCostBilling(provider, operation, meta);
    const event: LeadCostEvent = {
      id: Number(row.id),
      runId: row.run_id != null ? String(row.run_id) : null,
      requestId: row.request_id != null ? String(row.request_id) : null,
      provider,
      operation,
      units: Number(row.units),
      unitType: String(row.unit_type),
      usd,
      model: row.model != null ? String(row.model) : null,
      meta,
      createdAt: toIso(row.created_at),
      billing,
    };
    events.push(event);
    totalUsd += usd;
    if (billing === "verified") verifiedUsd += usd;
    else estimatedUsd += usd;

    const bucket = providerBuckets.get(provider);
    if (bucket) {
      bucket.usdTotal += usd;
      bucket.unitsTotal += Number(row.units);
      bucket.eventCount += 1;
      if (billing === "verified") bucket.verifiedUsd += usd;
      else bucket.estimatedUsd += usd;
      bucket.events.push(event);
    } else {
      providerBuckets.set(provider, {
        provider,
        usdTotal: usd,
        unitsTotal: Number(row.units),
        unitType: String(row.unit_type),
        eventCount: 1,
        verifiedUsd: billing === "verified" ? usd : 0,
        estimatedUsd: billing === "estimated" ? usd : 0,
        events: [event],
      });
    }
  }

  return {
    totalUsd,
    verifiedUsd,
    estimatedUsd,
    firecrawlCreditsEst,
    eventCount: events.length,
    byProvider: [...providerBuckets.values()].sort((a, b) => b.usdTotal - a.usdTotal),
    events,
  };
}

export async function getSourceChecksForLead(placeId: string): Promise<SourceCheck[]> {
  const client = await supabase();
  const { data, error } = await client
    .from("run_events")
    .select("stage, ran, reason")
    .eq("place_id", placeId)
    .like("stage", "source_check:%")
    .order("created_at", { ascending: false })
    .limit(30);
  throwOnError(error, "source checks");

  const seen = new Set<string>();
  const checks: SourceCheck[] = [];
  for (const row of data ?? []) {
    const sourceKey = String(row.stage).replace("source_check:", "");
    if (seen.has(sourceKey)) continue;
    seen.add(sourceKey);
    const reason = row.reason != null ? String(row.reason) : "";
    let status = "skipped";
    if (reason.startsWith("checked")) status = "checked";
    else if (reason.startsWith("login_wall")) status = "login_wall";
    else if (reason.startsWith("not_found")) status = "not_found";
    checks.push({ source_key: sourceKey, status, reason });
  }
  return checks;
}

export async function getRelatedLeads(placeId: string): Promise<RelatedLead[]> {
  const client = await supabase();
  const { data: leadRow, error: leadErr } = await client
    .from("leads")
    .select("enriched_json, profile_key")
    .eq("place_id", placeId)
    .maybeSingle();
  throwOnError(leadErr, "related lead");
  if (!leadRow) return [];

  const enrichedData = parseEnrichedJson(leadRow.enriched_json) as { website?: string };
  let domain = "";
  if (enrichedData.website) {
    try {
      domain = new URL(enrichedData.website).hostname.replace(/^www\./, "");
    } catch {
      domain = "";
    }
  }

  const related: RelatedLead[] = [];
  const seen = new Set<string>([placeId]);

  const { data: ownerRows, error: ownerErr } = await client
    .from("owner_records")
    .select("owner_name_normalized, owner_name")
    .eq("place_id", placeId);
  throwOnError(ownerErr, "owner_records");
  const owner = ownerRows?.[0];

  if (owner?.owner_name_normalized) {
    const { data: sameOwnerRows, error } = await client
      .from("owner_records")
      .select("place_id, owner_name, leads ( business_name, city )")
      .eq("owner_name_normalized", owner.owner_name_normalized)
      .neq("place_id", placeId)
      .limit(10);
    throwOnError(error, "same owner");
    for (const r of sameOwnerRows ?? []) {
      const pid = String(r.place_id);
      if (seen.has(pid)) continue;
      seen.add(pid);
      const lead = Array.isArray(r.leads) ? r.leads[0] : r.leads;
      related.push({
        place_id: pid,
        business_name: lead ? String(lead.business_name) : pid,
        city: lead?.city != null ? String(lead.city) : null,
        relation: "same_owner",
        detail: String(r.owner_name),
      });
    }
  }

  const profileKey = (leadRow.profile_key as string | null) ?? "";
  if (profileKey.startsWith("mgmt:")) {
    const { data: mgrRows, error } = await client
      .from("leads")
      .select("place_id, business_name, city")
      .eq("profile_key", profileKey)
      .neq("place_id", placeId)
      .limit(10);
    throwOnError(error, "same manager");
    for (const r of mgrRows ?? []) {
      const pid = String(r.place_id);
      if (seen.has(pid)) continue;
      seen.add(pid);
      related.push({
        place_id: pid,
        business_name: String(r.business_name),
        city: (r.city as string | null) ?? null,
        relation: "same_manager",
        detail: profileKey,
      });
    }
  }

  if (domain) {
    const { data: domainRows, error } = await client
      .from("leads")
      .select("place_id, business_name, city")
      .neq("place_id", placeId)
      .filter("enriched_json->>website", "ilike", `%${domain}%`)
      .limit(10);
    throwOnError(error, "same domain");
    for (const r of domainRows ?? []) {
      const pid = String(r.place_id);
      if (seen.has(pid)) continue;
      seen.add(pid);
      related.push({
        place_id: pid,
        business_name: String(r.business_name),
        city: (r.city as string | null) ?? null,
        relation: "same_domain",
        detail: domain,
      });
    }
  }

  return related.slice(0, 10);
}

export async function getLeadDetail(placeId: string): Promise<LeadDetail | null> {
  const client = await supabase();
  const { data: row, error } = await client
    .from("leads")
    .select(
      "place_id, business_name, market_key, category_key, city, last_enriched_at, enrichment_status, confidence, lead_score, enriched_json, sales_feedback ( status )",
    )
    .eq("place_id", placeId)
    .maybeSingle();
  throwOnError(error, "lead detail");
  if (!row) return null;

  const data = parseEnrichedJson(row.enriched_json) as Record<string, unknown>;
  const enriched = data as EnrichedJson;
  const rawContacts = Array.isArray(data.site_contacts)
    ? (data.site_contacts as Record<string, unknown>[])
    : [];
  const siteContacts: SiteContact[] = rawContacts.map((c) => ({
    name: presentOrNull(c.name),
    role: presentOrNull(c.role) ?? presentOrNull(c.label),
    phone: presentOrNull(c.phone),
    email_or_form: presentOrNull(c.email_or_form) ?? presentOrNull(c.email),
    source_url: presentOrNull(c.source_url),
    verification: presentOrNull(c.verification),
    quote: presentOrNull(c.quote),
  }));

  const addressParts = [data.address, data.city, data.state]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean);

  const crmStatus = crmStatusFromFeedback(
    row.sales_feedback as { status?: string } | { status?: string }[] | null,
  );
  const categoryKey = (row.category_key as string | null) ?? null;
  const leadType = leadTypeFromCategory(categoryKey);

  return {
    place_id: String(row.place_id),
    business_name: String(data.business_name ?? row.business_name ?? "Unknown"),
    market_key: (row.market_key as string | null) ?? null,
    category_key: categoryKey,
    city: (row.city as string | null) ?? null,
    last_enriched_at: toIsoOrNull(row.last_enriched_at),
    enrichment_status: (row.enrichment_status as string | null) ?? null,
    confidence: (row.confidence as string | null) ?? null,
    verification_level:
      typeof data.verification_level === "string" ? data.verification_level : null,
    lead_score: (row.lead_score as number | null) ?? null,
    status: salesStatus(enriched),
    crm_status: crmStatus,
    lead_type: leadType,
    phone: primaryPhone(enriched),
    address: addressParts.length > 0 ? addressParts.join(", ") : null,
    website: presentOrNull(data.website),
    google_maps_url: presentOrNull(data.google_maps_url),
    best_contact_name: presentOrNull(data.best_contact_name),
    best_contact_role: presentOrNull(data.best_contact_role),
    best_contact_phone: presentOrNull(data.best_contact_phone),
    best_contact_email_or_form: presentOrNull(data.best_contact_email_or_form),
    property_manager_clue: presentOrNull(data.property_manager_or_ownership_clue),
    why_good_fit: presentOrNull(data.why_this_is_a_good_fit),
    why_now: presentOrNull(data.why_now),
    score_breakdown:
      data.score_breakdown && typeof data.score_breakdown === "object"
        ? (data.score_breakdown as Record<string, number>)
        : {},
    talking_points: normalizeListText(presentOrNull(data.sales_talking_points)),
    need_signals: normalizeListText(presentOrNull(data.exterior_cleaning_need_signals)),
    site_contacts: siteContacts,
    facts: Array.isArray(data.facts)
      ? (data.facts as Record<string, unknown>[]).map((f) => ({
          fact_kind: String(f.fact_kind ?? ""),
          value:
            f.value && typeof f.value === "object"
              ? (f.value as Record<string, string>)
              : {},
          source_kind: String(f.source_kind ?? ""),
          source_url: String(f.source_url ?? ""),
          method: String(f.method ?? ""),
          quote: String(f.quote ?? ""),
          verification: String(f.verification ?? ""),
          observed_at: String(f.observed_at ?? ""),
        }))
      : [],
    evidence_urls: Array.isArray(data.evidence_urls)
      ? (data.evidence_urls as string[]).filter((u) => typeof u === "string" && u.trim())
      : [],
    notes: presentOrNull(data.notes),
    related: await getRelatedLeads(placeId).catch(() => []),
    source_checks: await getSourceChecksForLead(placeId).catch(() => []),
    costs: await getLeadCosts(placeId).catch(() => emptyLeadCosts()),
  };
}

function emptyRunCosts(): RunCosts {
  return {
    totalUsd: 0,
    verifiedUsd: 0,
    estimatedUsd: 0,
    firecrawlCreditsEst: 0,
    eventCount: 0,
    leadCount: 0,
    byProvider: [],
  };
}

export async function getRunCosts(runId: string): Promise<RunCosts> {
  const client = await supabase();
  const { data: rows, error } = await client
    .from("cost_events")
    .select("provider, operation, units, unit_type, usd, meta_json, place_id")
    .eq("run_id", runId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  throwOnError(error, "run costs");

  const { data: creditsRows, error: creditsErr } = await client
    .from("run_events")
    .select("credits_est")
    .eq("run_id", runId);
  throwOnError(creditsErr, "run credits");
  const firecrawlCreditsEst = (creditsRows ?? []).reduce(
    (sum, row) => sum + Number(row.credits_est ?? 0),
    0,
  );

  const leadIds = new Set<string>();
  for (const row of rows ?? []) {
    if (row.place_id) leadIds.add(String(row.place_id));
  }

  if (!rows?.length) {
    return { ...emptyRunCosts(), firecrawlCreditsEst, leadCount: leadIds.size };
  }

  type OpBucket = RunCosts["byProvider"][number]["operations"][number];
  type ProviderBucket = RunCosts["byProvider"][number] & {
    opMap: Map<string, OpBucket>;
  };

  const providerBuckets = new Map<string, ProviderBucket>();
  let totalUsd = 0;
  let verifiedUsd = 0;
  let estimatedUsd = 0;

  for (const row of rows) {
    if (row.place_id) leadIds.add(String(row.place_id));
    const meta = parseCostMeta(row.meta_json);
    const usd = row.usd != null ? Number(row.usd) : 0;
    const provider = String(row.provider);
    const operation = String(row.operation);
    const billing = classifyCostBilling(provider, operation, meta);
    totalUsd += usd;
    if (billing === "verified") verifiedUsd += usd;
    else estimatedUsd += usd;

    let bucket = providerBuckets.get(provider);
    if (!bucket) {
      bucket = {
        provider,
        usdTotal: 0,
        unitsTotal: 0,
        unitType: String(row.unit_type),
        eventCount: 0,
        verifiedUsd: 0,
        estimatedUsd: 0,
        operations: [],
        opMap: new Map(),
      };
      providerBuckets.set(provider, bucket);
    }
    bucket.usdTotal += usd;
    bucket.unitsTotal += Number(row.units);
    bucket.eventCount += 1;
    if (billing === "verified") bucket.verifiedUsd += usd;
    else bucket.estimatedUsd += usd;

    const opKey = `${operation}:${row.unit_type}`;
    let op = bucket.opMap.get(opKey);
    if (!op) {
      op = {
        operation,
        usd: 0,
        units: 0,
        unitType: String(row.unit_type),
        count: 0,
        billing,
      };
      bucket.opMap.set(opKey, op);
      bucket.operations.push(op);
    }
    op.usd += usd;
    op.units += Number(row.units);
    op.count += 1;
  }

  const byProvider = [...providerBuckets.values()]
    .map((bucket) => ({
      provider: bucket.provider,
      usdTotal: bucket.usdTotal,
      unitsTotal: bucket.unitsTotal,
      unitType: bucket.unitType,
      eventCount: bucket.eventCount,
      verifiedUsd: bucket.verifiedUsd,
      estimatedUsd: bucket.estimatedUsd,
      operations: [...bucket.operations].sort((a, b) => b.usd - a.usd),
    }))
    .sort((a, b) => b.usdTotal - a.usdTotal);

  return {
    totalUsd,
    verifiedUsd,
    estimatedUsd,
    firecrawlCreditsEst,
    eventCount: rows.length,
    leadCount: leadIds.size,
    byProvider,
  };
}

function toTimelineStage(row: RunEventRow): RunTimelineStage {
  return {
    stage: row.stage,
    ran: row.ran === 1,
    reason: row.reason,
    credits_est: row.credits_est,
    created_at: row.created_at,
  };
}

export async function getRunTimeline(runId: string): Promise<RunTimeline> {
  const events = await getRunEvents(runId);
  const runEvents: RunTimelineStage[] = [];
  const leadMap = new Map<string, RunTimelineLead>();
  const client = await supabase();

  for (const row of events) {
    if (!row.place_id) {
      runEvents.push(toTimelineStage(row));
      continue;
    }

    let lead = leadMap.get(row.place_id);
    if (!lead) {
      const { data: leadRow, error } = await client
        .from("leads")
        .select("business_name, category_key, lead_score, enriched_json")
        .eq("place_id", row.place_id)
        .maybeSingle();
      throwOnError(error, "timeline lead");

      let verificationLevel: string | null = null;
      if (leadRow?.enriched_json) {
        const data = parseEnrichedJson(leadRow.enriched_json);
        verificationLevel =
          typeof data.verification_level === "string" ? data.verification_level : null;
      }

      lead = {
        place_id: row.place_id,
        business_name: leadRow?.business_name != null ? String(leadRow.business_name) : null,
        category_key: (leadRow?.category_key as string | null) ?? null,
        verification_level: verificationLevel,
        lead_score: (leadRow?.lead_score as number | null) ?? null,
        creditsEst: 0,
        done: false,
        stages: [],
      };
      leadMap.set(row.place_id, lead);
    }

    lead.stages.push(toTimelineStage(row));
    lead.creditsEst += row.credits_est ?? 0;
    if (row.stage === "final") lead.done = true;
  }

  return {
    runEvents,
    leads: [...leadMap.values()],
  };
}

export async function getRunDetail(runId: string): Promise<RunDetail | null> {
  const run = await getRun(runId);
  if (!run) return null;
  return {
    run,
    costs: await getRunCosts(runId),
    timeline: await getRunTimeline(runId),
  };
}

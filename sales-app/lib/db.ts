import { cache } from "react";
import * as supabaseReads from "./db-supabase";
import { dbAvailable, getSql } from "./pg";
import { shouldUseSupabaseReads } from "./use-supabase-reads";
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

export { dbAvailable };

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return String(value);
}

function toIsoOrNull(value: unknown): string | null {
  if (value == null) return null;
  return toIso(value);
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

export const getCreditBalances = cache(async function getCreditBalances(): Promise<ProviderBalance[]> {
  if (shouldUseSupabaseReads()) return supabaseReads.getCreditBalances();
  if (!dbAvailable()) return [];
  const sql = getSql();

  const rows = await sql`
    SELECT DISTINCT ON (provider)
      provider, remaining_credits, used_credits, snapshot_json, created_at
    FROM credit_snapshots
    ORDER BY provider, created_at DESC
  `;

  return rows.map((row) => {
    const parsed =
      row.provider === "firecrawl"
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
    return {
      provider: String(row.provider),
      remaining: parsed.remaining,
      used: parsed.used,
      plan: parsed.plan,
      unitLabel: balanceUnitLabel(String(row.provider)),
      snapshotAt: toIsoOrNull(row.created_at),
    };
  });
});

type EnrichedJson = {
  investigation_status?: string;
  verification_level?: string;
  main_phone?: string | null;
  site_contacts?: { phone?: string; email?: string }[];
  best_contact_phone?: string;
  best_contact_email_or_form?: string;
  facts?: unknown[];
};

function parseEnrichedJson(raw: unknown): EnrichedJson {
  if (raw == null) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as EnrichedJson;
  }
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as EnrichedJson;
    } catch {
      return {};
    }
  }
  return {};
}

function isReadyToCall(data: EnrichedJson): boolean {
  const hasOutreach = (data.site_contacts ?? []).some(
    (c) =>
      (c.phone && c.phone.trim() !== "" && c.phone !== "Not found") ||
      (c.email && c.email.includes("@")),
  );
  const bestPhone =
    data.best_contact_phone && data.best_contact_phone !== "Not found"
      ? data.best_contact_phone
      : "";
  const bestEmail =
    data.best_contact_email_or_form &&
    data.best_contact_email_or_form !== "Not found" &&
    data.best_contact_email_or_form.includes("@")
      ? data.best_contact_email_or_form
      : "";
  const callable = hasOutreach || Boolean(bestPhone) || Boolean(bestEmail);
  if (data.investigation_status === "enriched" && callable) return true;
  if (data.main_phone && callable) return true;
  return false;
}

function salesStatus(data: EnrichedJson): string {
  return isReadyToCall(data) ? "Ready to call" : "Needs research";
}

function primaryPhone(data: EnrichedJson): string | null {
  if (data.main_phone && data.main_phone !== "Not found") return data.main_phone;
  for (const c of data.site_contacts ?? []) {
    if (c.phone && c.phone !== "Not found") return c.phone;
  }
  if (data.best_contact_phone && data.best_contact_phone !== "Not found") {
    return data.best_contact_phone;
  }
  return null;
}

export const getOverview = cache(async function getOverview(): Promise<OverviewStats> {
  if (shouldUseSupabaseReads()) return supabaseReads.getOverview();
  if (!dbAvailable()) return emptyOverview();
  const sql = getSql();

  const totalRow = await sql`SELECT COUNT(*)::int AS n FROM leads`;
  const totalLeads = totalRow[0]?.n as number;

  const enrichedRow =
    await sql`SELECT COUNT(*)::int AS n FROM leads WHERE enriched_json IS NOT NULL`;
  const enrichedLeads = enrichedRow[0]?.n as number;

  let readyToCall = 0;
  const enrichedRows =
    await sql`SELECT enriched_json FROM leads WHERE enriched_json IS NOT NULL`;
  for (const row of enrichedRows) {
    const data = parseEnrichedJson(row.enriched_json);
    if (isReadyToCall(data)) readyToCall += 1;
  }

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthIso = monthStart.toISOString();

  const creditsRow = await sql`
    SELECT COALESCE(SUM(units), 0)::float AS credits
    FROM cost_events
    WHERE provider = 'firecrawl' AND created_at >= ${monthIso}
  `;
  const creditsThisMonth = Number(creditsRow[0]?.credits ?? 0);

  const browserUseRow = await sql`
    SELECT COALESCE(SUM(usd), 0)::float AS usd
    FROM cost_events
    WHERE provider = 'browser_use' AND created_at >= ${monthIso}
  `;
  const browserUseUsdThisMonth = Number(browserUseRow[0]?.usd ?? 0);

  const aiGatewayRow = await sql`
    SELECT COALESCE(SUM(usd), 0)::float AS usd
    FROM cost_events
    WHERE provider = 'ai_gateway' AND created_at >= ${monthIso}
  `;
  const aiGatewayUsdThisMonth = Number(aiGatewayRow[0]?.usd ?? 0);

  const providerRows = await sql`
    SELECT provider,
           unit_type,
           COALESCE(SUM(usd), 0)::float AS usd,
           COALESCE(SUM(units), 0)::float AS units,
           COUNT(*)::int AS count
    FROM cost_events
    WHERE created_at >= ${monthIso}
    GROUP BY provider, unit_type
    ORDER BY usd DESC
  `;

  const merged = new Map<string, OverviewStats["usdByProvider"][number]>();
  for (const row of providerRows) {
    const provider = String(row.provider);
    const existing = merged.get(provider);
    const usd = Number(row.usd);
    const units = Number(row.units);
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
  const usdByProvider = [...merged.values()].sort((a, b) => b.usd - a.usd);

  return {
    totalLeads,
    enrichedLeads,
    readyToCall,
    readyToCallRate: enrichedLeads > 0 ? readyToCall / enrichedLeads : 0,
    creditsThisMonth,
    browserUseUsdThisMonth,
    aiGatewayUsdThisMonth,
    usdByProvider,
    balances: await getCreditBalances(),
  };
});

export const listLeads = cache(async function listLeads(filters?: {
  market?: string;
  category?: string;
  status?: string;
  crmStatus?: string;
  type?: string;
  minScore?: number;
  dudsOnly?: boolean;
  limit?: number;
}): Promise<LeadRow[]> {
  if (shouldUseSupabaseReads()) return supabaseReads.listLeads(filters);
  if (!dbAvailable()) return [];
  const sql = getSql();
  const limit = filters?.limit ?? 500;

  const rows = await sql`
    SELECT leads.place_id, leads.business_name, leads.market_key, leads.category_key, leads.city,
           leads.last_enriched_at, leads.enrichment_status, leads.confidence,
           leads.lead_score, leads.enriched_json,
           COALESCE(sf.status, 'New') AS crm_status,
           COALESCE(sf.addressed, false) AS addressed
    FROM leads
    LEFT JOIN sales_feedback sf ON sf.place_id = leads.place_id
    WHERE leads.enriched_json IS NOT NULL
    ${filters?.market ? sql`AND leads.market_key = ${filters.market}` : sql``}
    ${filters?.category ? sql`AND leads.category_key = ${filters.category}` : sql``}
    ${
      filters?.minScore !== undefined
        ? sql`AND COALESCE(leads.lead_score, 0) >= ${filters.minScore}`
        : sql``
    }
    ${
      filters?.dudsOnly
        ? sql`AND (
            COALESCE(leads.lead_score, 0) < 40
            OR leads.enrichment_status = 'needs_manual'
            OR leads.confidence = 'Low'
            OR leads.enrichment_status = 'unverified'
          )`
        : sql``
    }
    ORDER BY COALESCE(leads.lead_score, 0) DESC, leads.last_enriched_at DESC
    LIMIT ${limit}
  `;

  const leads: LeadRow[] = [];
  for (const row of rows) {
    const data = parseEnrichedJson(row.enriched_json);
    const status = salesStatus(data);
    if (filters?.status && status !== filters.status) continue;
    const crmStatus = String(row.crm_status ?? "New");
    if (filters?.crmStatus && crmStatus !== filters.crmStatus) continue;
    const leadType: LeadType = (row.category_key as string | null)?.startsWith("vendor_")
      ? "vendor"
      : "client";
    if (filters?.type && leadType !== filters.type) continue;
    leads.push({
      place_id: String(row.place_id),
      business_name: String(row.business_name),
      market_key: (row.market_key as string | null) ?? null,
      category_key: (row.category_key as string | null) ?? null,
      city: (row.city as string | null) ?? null,
      last_enriched_at: toIsoOrNull(row.last_enriched_at),
      enrichment_status: (row.enrichment_status as string | null) ?? null,
      confidence: (row.confidence as string | null) ?? null,
      verification_level:
        typeof data.verification_level === "string" ? data.verification_level : null,
      lead_score: (row.lead_score as number | null) ?? null,
      status,
      crm_status: crmStatus as CrmStatus,
      lead_type: leadType,
      phone: primaryPhone(data),
      addressed: Boolean(row.addressed),
    });
  }
  return leads;
});

const NOT_FOUND = "Not found";

function presentOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === NOT_FOUND) return null;
  return trimmed;
}

/** Some enriched fields are stored as stringified lists ("['• a', '• b']") — flatten to lines. */
function normalizeListText(value: string | null): string | null {
  if (!value) return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return value;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String).join("\n");
  } catch {
    // fall through to Python-repr handling
  }
  const parts = trimmed
    .slice(1, -1)
    .split(/['"],\s*['"]/)
    .map((p) => p.replace(/^\s*['"]+|['"]+\s*$/g, "").trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : value;
}

export async function getRelatedLeads(placeId: string): Promise<RelatedLead[]> {
  if (shouldUseSupabaseReads()) return supabaseReads.getRelatedLeads(placeId);
  if (!dbAvailable()) return [];
  const sql = getSql();

  const leadRows = await sql`
    SELECT enriched_json, profile_key FROM leads WHERE place_id = ${placeId}
  `;
  const row = leadRows[0];
  if (!row) return [];

  let domain = "";
  const enrichedData = parseEnrichedJson(row.enriched_json) as { website?: string };
  const website = enrichedData.website ?? "";
  if (website) {
    try {
      domain = new URL(website).hostname.replace(/^www\./, "");
    } catch {
      domain = "";
    }
  }

  const related: RelatedLead[] = [];
  const seen = new Set<string>([placeId]);

  const ownerRows = await sql`
    SELECT owner_name_normalized, owner_name FROM owner_records WHERE place_id = ${placeId}
  `;
  const owner = ownerRows[0];

  if (owner?.owner_name_normalized) {
    const sameOwnerRows = await sql`
      SELECT l.place_id, l.business_name, l.city, o.owner_name
      FROM owner_records o
      JOIN leads l ON l.place_id = o.place_id
      WHERE o.owner_name_normalized = ${owner.owner_name_normalized}
        AND o.place_id != ${placeId}
      LIMIT 10
    `;
    for (const r of sameOwnerRows) {
      const pid = String(r.place_id);
      if (seen.has(pid)) continue;
      seen.add(pid);
      related.push({
        place_id: pid,
        business_name: String(r.business_name),
        city: (r.city as string | null) ?? null,
        relation: "same_owner",
        detail: String(r.owner_name),
      });
    }
  }

  const profileKey = (row.profile_key as string | null) ?? "";
  if (profileKey.startsWith("mgmt:")) {
    const mgrRows = await sql`
      SELECT place_id, business_name, city
      FROM leads
      WHERE profile_key = ${profileKey} AND place_id != ${placeId}
      LIMIT 10
    `;
    for (const r of mgrRows) {
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
    const domainPattern = `%${domain}%`;
    const domainRows = await sql`
      SELECT place_id, business_name, city
      FROM leads
      WHERE place_id != ${placeId} AND enriched_json::text LIKE ${domainPattern}
      LIMIT 10
    `;
    for (const r of domainRows) {
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

export async function getSourceChecksForLead(placeId: string): Promise<SourceCheck[]> {
  if (shouldUseSupabaseReads()) return supabaseReads.getSourceChecksForLead(placeId);
  if (!dbAvailable()) return [];
  const sql = getSql();

  const rows = await sql`
    SELECT stage, ran, reason FROM run_events
    WHERE place_id = ${placeId} AND stage LIKE 'source_check:%'
    ORDER BY created_at DESC
    LIMIT 30
  `;

  const seen = new Set<string>();
  const checks: SourceCheck[] = [];
  for (const row of rows) {
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

const FIRECRAWL_ESTIMATE_OPS = new Set([
  "map",
  "search",
  "search_contact",
  "search_website",
]);

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

export async function getLeadCosts(placeId: string): Promise<LeadCosts> {
  if (shouldUseSupabaseReads()) return supabaseReads.getLeadCosts(placeId);
  if (!dbAvailable()) return emptyLeadCosts();
  const sql = getSql();

  const rows = await sql`
    SELECT id, run_id, request_id, provider, operation, units, unit_type,
           usd, model, meta_json, created_at
    FROM cost_events
    WHERE place_id = ${placeId}
    ORDER BY created_at ASC, id ASC
  `;

  const creditsRows = await sql`
    SELECT COALESCE(SUM(credits_est), 0)::int AS total
    FROM run_events WHERE place_id = ${placeId}
  `;
  const firecrawlCreditsEst = Number(creditsRows[0]?.total ?? 0);

  if (rows.length === 0) {
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

  const byProvider = [...providerBuckets.values()].sort(
    (a, b) => b.usdTotal - a.usdTotal,
  );

  return {
    totalUsd,
    verifiedUsd,
    estimatedUsd,
    firecrawlCreditsEst,
    eventCount: events.length,
    byProvider,
    events,
  };
}

export const getLeadDetail = cache(async function getLeadDetail(placeId: string): Promise<LeadDetail | null> {
  if (shouldUseSupabaseReads()) return supabaseReads.getLeadDetail(placeId);
  if (!dbAvailable()) return null;
  const sql = getSql();

  const leadRows = await sql`SELECT * FROM leads WHERE place_id = ${placeId}`;
  const row = leadRows[0];
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

  const fbRows = await sql`
    SELECT status, addressed FROM sales_feedback WHERE place_id = ${placeId}
  `;
  const crmStatus: CrmStatus = (fbRows[0]?.status as CrmStatus) || "New";
  const addressed = Boolean(fbRows[0]?.addressed);
  const leadType: LeadType = (row.category_key as string | null)?.startsWith("vendor_")
    ? "vendor"
    : "client";

  return {
    place_id: String(row.place_id),
    business_name: String(data.business_name ?? row.business_name ?? "Unknown"),
    market_key: (row.market_key as string | null) ?? null,
    category_key: (row.category_key as string | null) ?? null,
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
    addressed,
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
    related: await getRelatedLeads(placeId),
    source_checks: await getSourceChecksForLead(placeId),
    costs: await getLeadCosts(placeId),
  };
});

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
  if (shouldUseSupabaseReads()) return supabaseReads.getRunEvents(runId);
  if (!dbAvailable()) return [];
  const sql = getSql();

  const rows = await sql`
    SELECT id, run_id, place_id, stage, ran, reason, credits_est, created_at
    FROM run_events
    WHERE run_id = ${runId}
    ORDER BY created_at ASC
  `;
  return rows.map((row) => mapRunEventRow(row as Record<string, unknown>));
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

export async function getRun(runId: string): Promise<RunRow | null> {
  if (shouldUseSupabaseReads()) return supabaseReads.getRun(runId);
  if (!dbAvailable()) return null;
  const sql = getSql();

  const rows = await sql`
    SELECT run_id, started_at, finished_at, run_type, market_key, category_key,
           discovered_count, skipped_known_count, enriched_count, status
    FROM runs
    WHERE run_id = ${runId}
  `;
  const row = rows[0];
  if (!row) return null;
  return {
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
  };
}

export async function getRunCosts(runId: string): Promise<RunCosts> {
  if (shouldUseSupabaseReads()) return supabaseReads.getRunCosts(runId);
  if (!dbAvailable()) return emptyRunCosts();
  const sql = getSql();

  const rows = await sql`
    SELECT provider, operation, units, unit_type, usd, meta_json, place_id
    FROM cost_events
    WHERE run_id = ${runId}
    ORDER BY created_at ASC, id ASC
  `;

  const creditsRows = await sql`
    SELECT COALESCE(SUM(credits_est), 0)::int AS total
    FROM run_events WHERE run_id = ${runId}
  `;
  const firecrawlCreditsEst = Number(creditsRows[0]?.total ?? 0);

  const leadIds = new Set<string>();
  for (const row of rows) {
    if (row.place_id) leadIds.add(String(row.place_id));
  }

  if (rows.length === 0) {
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
  if (shouldUseSupabaseReads()) return supabaseReads.getRunTimeline(runId);
  const events = await getRunEvents(runId);
  const runEvents: RunTimelineStage[] = [];
  const leadMap = new Map<string, RunTimelineLead>();

  if (!dbAvailable()) {
    return { runEvents, leads: [] };
  }
  const sql = getSql();

  for (const row of events) {
    if (!row.place_id) {
      runEvents.push(toTimelineStage(row));
      continue;
    }

    let lead = leadMap.get(row.place_id);
    if (!lead) {
      const leadRows = await sql`
        SELECT business_name, category_key, lead_score, enriched_json
        FROM leads WHERE place_id = ${row.place_id}
      `;
      const leadRow = leadRows[0];

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

export const getRunDetail = cache(async function getRunDetail(runId: string): Promise<RunDetail | null> {
  if (shouldUseSupabaseReads()) return supabaseReads.getRunDetail(runId);
  const run = await getRun(runId);
  if (!run) return null;
  return {
    run,
    costs: await getRunCosts(runId),
    timeline: await getRunTimeline(runId),
  };
});

export const listRuns = cache(async function listRuns(limit = 50): Promise<RunRow[]> {
  if (shouldUseSupabaseReads()) return supabaseReads.listRuns(limit);
  if (!dbAvailable()) return [];
  const sql = getSql();

  const rows = await sql`
    SELECT run_id, started_at, finished_at, run_type, market_key, category_key,
           discovered_count, skipped_known_count, enriched_count, status
    FROM runs
    ORDER BY started_at DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
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
});

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

export const listRequests = cache(async function listRequests(limit = 50): Promise<RequestRow[]> {
  if (shouldUseSupabaseReads()) return supabaseReads.listRequests(limit);
  if (!dbAvailable()) return [];
  const sql = getSql();

  const rows = await sql`
    SELECT request_id, created_at, raw_prompt, spec_json, status,
           leads_delivered, credits_spent, usd_spent
    FROM lead_requests
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    request_id: String(row.request_id),
    created_at: toIso(row.created_at),
    raw_prompt: String(row.raw_prompt),
    status: String(row.status),
    leads_delivered: Number(row.leads_delivered),
    credits_spent: Number(row.credits_spent),
    usd_spent: row.usd_spent != null ? Number(row.usd_spent) : null,
    spec: parseSpecJson(row.spec_json),
  }));
});

export const getCostSeries = cache(async function getCostSeries(days = 30): Promise<CostSeries> {
  if (shouldUseSupabaseReads()) return supabaseReads.getCostSeries(days);
  if (!dbAvailable()) {
    return { byDay: [], byProvider: [], byOperation: [], balances: [] };
  }
  const sql = getSql();

  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceDate = since.toISOString().slice(0, 10);
  const sinceIso = since.toISOString();

  const byDayRows = await sql`
    SELECT date,
           usd,
           firecrawl_credits,
           browser_use_usd,
           ai_gateway_usd,
           google_places_usd
    FROM cost_by_day
    WHERE date >= ${sinceDate}
    ORDER BY date
  `;

  const byDay = byDayRows.map((row) => ({
    date: String(row.date),
    usd: Number(row.usd),
    firecrawlCredits: Number(row.firecrawl_credits),
    browserUseUsd: Number(row.browser_use_usd),
    aiGatewayUsd: Number(row.ai_gateway_usd),
    googlePlacesUsd: Number(row.google_places_usd),
  }));

  const providerRows = await sql`
    SELECT provider, unit_type, usd, units, event_count
    FROM cost_by_provider
  `;

  const mergedProviders = new Map<string, CostSeries["byProvider"][number]>();
  for (const row of providerRows) {
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
  const byProvider = [...mergedProviders.values()].sort((a, b) => b.usd - a.usd);

  const byOperationRows = await sql`
    SELECT provider, operation, unit_type,
           COALESCE(SUM(usd), 0)::float AS usd,
           COUNT(*)::int AS count
    FROM cost_events
    WHERE created_at >= ${sinceIso}
    GROUP BY provider, operation, unit_type
    ORDER BY usd DESC
    LIMIT 20
  `;

  return {
    byDay,
    byProvider,
    byOperation: byOperationRows.map((row) => ({
      provider: String(row.provider),
      operation: String(row.operation),
      usd: Number(row.usd),
      count: Number(row.count),
      unitType: String(row.unit_type),
    })),
    balances: await getCreditBalances(),
  };
});

export const listFilterOptions = cache(async function listFilterOptions(): Promise<{
  markets: string[];
  categories: string[];
}> {
  if (shouldUseSupabaseReads()) return supabaseReads.listFilterOptions();
  if (!dbAvailable()) return { markets: [], categories: [] };
  const sql = getSql();

  const marketRows = await sql`
    SELECT DISTINCT market_key FROM leads
    WHERE market_key IS NOT NULL
    ORDER BY market_key
  `;
  const categoryRows = await sql`
    SELECT DISTINCT category_key FROM leads
    WHERE category_key IS NOT NULL
    ORDER BY category_key
  `;

  return {
    markets: marketRows.map((r) => String(r.market_key)),
    categories: categoryRows.map((r) => String(r.category_key)),
  };
});

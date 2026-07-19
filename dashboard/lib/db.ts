import { cache } from "react";
import { buildCostBudget } from "./cost-budget";
import { inferFirecrawlPlan } from "./config";
import {
  isVerifiedDecisionMaker,
  leadReadinessStatus,
  primaryCallablePhone,
} from "./lead-readiness";
import { isLeadFinishedStage } from "./pipeline/stages";
import { dbAvailable, getSql } from "./pg";
import { createTtlCache } from "./ttl-cache";
import type {
  CostSeries,
  CrmStatus,
  InventoryMode,
  LeadCostBilling,
  LeadCostByProvider,
  LeadCostEvent,
  LeadCosts,
  InsightReport,
  LeadDetail,
  LeadFact,
  LeadOutcome,
  LeadRow,
  LeadTouch,
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
    partialInventory: 0,
    verifiedThisMonth: 0,
    creditsThisMonth: 0,
    creditsPerVerifiedDm: null,
    creditsPerVerifiedDmCaveat: null,
    usdThisMonth: 0,
    usdPerVerifiedDm: null,
    minutesPerVerifiedDm: null,
    browserUseUsdThisMonth: 0,
    yield: { discovered: 0, enriched: 0, verifiedDm: 0 },
    usdByProvider: [],
    balances: [],
  };
}

function mapRunRow(row: Record<string, unknown>): RunRow {
  return {
    run_id: String(row.run_id),
    started_at: toIso(row.started_at),
    finished_at: toIsoOrNull(row.finished_at),
    run_type: String(row.run_type),
    market_key: (row.market_key as string | null) ?? null,
    category_key: (row.category_key as string | null) ?? null,
    campaign_key: row.campaign_key != null ? String(row.campaign_key) : null,
    job_id: row.job_id != null ? String(row.job_id) : null,
    discovered_count: Number(row.discovered_count ?? 0),
    skipped_known_count: Number(row.skipped_known_count ?? 0),
    enriched_count: Number(row.enriched_count ?? 0),
    status: String(row.status),
    stop_reason: row.stop_reason != null ? String(row.stop_reason) : null,
    stop_detail: row.stop_detail != null ? String(row.stop_detail) : null,
    error: row.error != null ? String(row.error) : null,
    verified_dm_count:
      row.verified_dm_count != null && row.verified_dm_count !== ""
        ? Number(row.verified_dm_count)
        : null,
    duration_ms:
      row.duration_ms != null && row.duration_ms !== ""
        ? Number(row.duration_ms)
        : null,
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
): {
  remaining: number | null;
  used: number | null;
  plan: number | null;
  planName: string | null;
  creditUsd: number | null;
  billingPeriodEnd: string | null;
} {
  const payload = snapshotPayload(snapshotJson);
  let plan: number | null = null;
  let snapRemaining: number | null = null;
  let snapUsed: number | null = null;
  let billingPeriodEnd: string | null = null;

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
        usedRaw = Math.max(0, plan - snapRemaining);
      }
      snapUsed = usedRaw != null ? Number(usedRaw) : null;
      const billingRaw = data.billingPeriodEnd ?? data.billing_period_end;
      billingPeriodEnd = billingRaw != null ? String(billingRaw) : null;
    } catch {
      // fall through with DB columns only
    }
  }

  const inferred = inferFirecrawlPlan({ planCredits: plan });
  const payloadName =
    payload && typeof (payload.planName ?? payload.plan_name) === "string"
      ? String(payload.planName ?? payload.plan_name)
      : null;

  return {
    remaining: remaining ?? snapRemaining,
    used: used ?? snapUsed,
    plan,
    planName: payloadName ?? inferred?.name ?? null,
    creditUsd:
      inferred && inferred.monthlyUsd > 0 && inferred.monthlyCredits > 0
        ? inferred.monthlyUsd / inferred.monthlyCredits
        : null,
    billingPeriodEnd,
  };
}

export const getCreditBalances = cache(async function getCreditBalances(): Promise<ProviderBalance[]> {
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
            planName: null,
            creditUsd: null,
            billingPeriodEnd: null,
          };
    return {
      provider: String(row.provider),
      remaining: parsed.remaining,
      used: parsed.used,
      plan: parsed.plan,
      planName: parsed.planName,
      creditUsd: parsed.creditUsd,
      billingPeriodEnd: parsed.billingPeriodEnd,
      unitLabel: balanceUnitLabel(String(row.provider)),
      snapshotAt: toIsoOrNull(row.created_at),
    };
  });
});

type EnrichedJson = {
  investigation_status?: string;
  verification_level?: string;
  main_phone?: string | null;
  site_contacts?: {
    label?: string | null;
    role?: string | null;
    name?: string | null;
    phone?: string | null;
    email?: string | null;
  }[];
  best_contact_name?: string;
  best_contact_role?: string;
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

function salesStatus(data: EnrichedJson): string {
  return leadReadinessStatus(data);
}

function primaryPhone(data: EnrichedJson): string | null {
  // Prefer the callable DM phone so Ready rows never surface Google mainline first.
  const dmPhone = primaryCallablePhone(data);
  if (dmPhone) return dmPhone;
  if (data.best_contact_phone && data.best_contact_phone !== "Not found") {
    return data.best_contact_phone;
  }
  for (const c of data.site_contacts ?? []) {
    if (c.phone && c.phone !== "Not found") return c.phone;
  }
  if (data.main_phone && data.main_phone !== "Not found") return data.main_phone;
  return null;
}

/** Overview aggregates change slowly between runs — skip repeat SQL on tab hops. */
const overviewTtl = createTtlCache<OverviewStats>(30_000);

export const getOverview = cache(async function getOverview(): Promise<OverviewStats> {
  const cached = overviewTtl.get();
  if (cached) return cached;
  if (!dbAvailable()) return emptyOverview();
  const sql = getSql();

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthIso = monthStart.toISOString();

  // Parallelize independent aggregates — sequential round-trips were 4–13s on /.
  const [
    totalRow,
    enrichedRow,
    readyRow,
    partialRow,
    creditsRow,
    attributedCreditsRow,
    efficiencyRows,
    browserUseRow,
    providerRows,
    balances,
  ] = await Promise.all([
    sql`SELECT COUNT(*)::int AS n FROM leads`,
    sql`SELECT COUNT(*)::int AS n FROM leads WHERE enriched_json IS NOT NULL`,
    sql`
      SELECT COUNT(*)::int AS n
      FROM leads
      WHERE lower(COALESCE(enrichment_status, '')) NOT IN (
          'skipped', 'needs_manual', 'enriching'
        )
        AND public.is_verified_decision_maker(
          enriched_json,
          enriched_json ->> 'verification_level'
        )
    `,
    sql`
      SELECT COUNT(*)::int AS n
      FROM leads
      WHERE enriched_json IS NOT NULL
        AND lower(COALESCE(enrichment_status, '')) NOT IN (
          'skipped', 'needs_manual', 'enriching'
        )
        AND COALESCE(enriched_json->>'verification_level', 'unverified') = 'partial'
    `,
    sql`
      SELECT COALESCE(SUM(units), 0)::float AS credits
      FROM cost_events
      WHERE provider = 'firecrawl' AND created_at >= ${monthIso}
    `,
    sql`
      SELECT COALESCE(SUM(ce.units), 0)::float AS credits
      FROM cost_events ce
      JOIN leads l ON l.place_id = ce.place_id
      WHERE ce.provider = 'firecrawl'
        AND ce.created_at >= ${monthIso}
        AND ce.place_id IS NOT NULL
        AND public.is_verified_decision_maker(
          l.enriched_json,
          l.enriched_json ->> 'verification_level'
        )
    `,
    sql`
      SELECT
        COUNT(*) FILTER (
          WHERE public.is_verified_decision_maker(
            l.enriched_json,
            l.enriched_json ->> 'verification_level'
          )
        )::int AS verified_count,
        COALESCE((
          SELECT SUM(re.duration_ms)
          FROM run_events re
          JOIN leads duration_lead ON duration_lead.place_id = re.place_id
          WHERE re.stage = 'lead_done'
            AND re.created_at >= ${monthIso}
            AND re.duration_ms IS NOT NULL
            AND public.is_verified_decision_maker(
              duration_lead.enriched_json,
              duration_lead.enriched_json ->> 'verification_level'
            )
        ), 0)::float AS verified_duration_ms
      FROM leads l
      WHERE l.last_enriched_at >= ${monthIso}
    `,
    sql`
      SELECT COALESCE(SUM(usd), 0)::float AS usd
      FROM cost_events
      WHERE provider = 'browser_use' AND created_at >= ${monthIso}
    `,
    sql`
      SELECT provider,
             unit_type,
             COALESCE(SUM(usd), 0)::float AS usd,
             COALESCE(SUM(units), 0)::float AS units,
             COUNT(*)::int AS count
      FROM cost_events
      WHERE created_at >= ${monthIso}
      GROUP BY provider, unit_type
      ORDER BY usd DESC
    `,
    getCreditBalances(),
  ]);

  const totalLeads = totalRow[0]?.n as number;
  const enrichedLeads = enrichedRow[0]?.n as number;
  const readyToCall = Number(readyRow[0]?.n ?? 0);
  const partialInventory = Number(partialRow[0]?.n ?? 0);
  const creditsThisMonth = Number(creditsRow[0]?.credits ?? 0);
  const attributedCredits = Number(attributedCreditsRow[0]?.credits ?? 0);
  const verifiedThisMonth = Number(efficiencyRows[0]?.verified_count ?? 0);
  const verifiedDurationMs = Number(efficiencyRows[0]?.verified_duration_ms ?? 0);
  const browserUseUsdThisMonth = Number(browserUseRow[0]?.usd ?? 0);

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
  const usdThisMonth = usdByProvider.reduce((sum, row) => sum + row.usd, 0);

  const useAttributed = attributedCredits > 0;
  const creditsForDmMetric = useAttributed ? attributedCredits : creditsThisMonth;
  const creditsPerVerifiedDmCaveat = useAttributed
    ? null
    : verifiedThisMonth > 0
      ? "Month-wide Firecrawl credits ÷ verified DMs (place_id attribution unavailable for most events)"
      : null;

  return overviewTtl.set({
    totalLeads,
    enrichedLeads,
    readyToCall,
    readyToCallRate: enrichedLeads > 0 ? readyToCall / enrichedLeads : 0,
    partialInventory,
    verifiedThisMonth,
    creditsThisMonth,
    creditsPerVerifiedDm:
      verifiedThisMonth > 0 ? creditsForDmMetric / verifiedThisMonth : null,
    creditsPerVerifiedDmCaveat,
    usdThisMonth,
    usdPerVerifiedDm: verifiedThisMonth > 0 ? usdThisMonth / verifiedThisMonth : null,
    minutesPerVerifiedDm:
      verifiedThisMonth > 0 ? verifiedDurationMs / 60_000 / verifiedThisMonth : null,
    browserUseUsdThisMonth,
    yield: {
      discovered: totalLeads,
      enriched: enrichedLeads,
      verifiedDm: readyToCall,
    },
    usdByProvider,
    balances,
  });
});

export const listLeads = cache(async function listLeads(filters?: {
  market?: string;
  category?: string;
  status?: string;
  crmStatus?: string;
  type?: string;
  minScore?: number;
  /** Default ready = verified DMs only. */
  inventoryMode?: InventoryMode;
  limit?: number;
}): Promise<LeadRow[]> {
  if (!dbAvailable()) return [];
  const sql = getSql();
  const limit = filters?.limit ?? 500;
  const inventoryMode: InventoryMode = filters?.inventoryMode ?? "ready";

  const rows = await sql`
    SELECT leads.place_id, leads.business_name, leads.market_key, leads.category_key, leads.city,
           leads.last_enriched_at, leads.enrichment_status, leads.confidence,
           leads.lead_score, leads.enriched_json,
           COALESCE(sf.status, 'New') AS crm_status
    FROM leads
    LEFT JOIN sales_feedback sf ON sf.place_id = leads.place_id
    WHERE leads.enriched_json IS NOT NULL
      AND lower(COALESCE(leads.enrichment_status, '')) NOT IN (
        'skipped', 'needs_manual', 'enriching'
      )
      ${
        inventoryMode === "ready"
          ? sql`AND public.is_verified_decision_maker(
              leads.enriched_json,
              leads.enriched_json ->> 'verification_level'
            )`
          : inventoryMode === "partial"
            ? sql`AND COALESCE(leads.enriched_json->>'verification_level', 'unverified') = 'partial'`
            : sql`AND COALESCE(leads.enriched_json->>'verification_level', 'unverified') IN ('verified', 'partial')`
      }
    ${filters?.market ? sql`AND leads.market_key = ${filters.market}` : sql``}
    ${filters?.category ? sql`AND leads.category_key = ${filters.category}` : sql``}
    ${
      filters?.type === "vendor"
        ? sql`AND COALESCE(leads.category_key, '') LIKE 'vendor_%'`
        : filters?.type === "client"
          ? sql`AND COALESCE(leads.category_key, '') NOT LIKE 'vendor_%'`
          : sql``
    }
    ${
      filters?.status === "Ready to call"
        ? sql`AND public.is_verified_decision_maker(
            leads.enriched_json,
            leads.enriched_json ->> 'verification_level'
          )`
        : filters?.status === "Needs research"
          ? sql`AND NOT public.is_verified_decision_maker(
              leads.enriched_json,
              leads.enriched_json ->> 'verification_level'
            )`
          : sql``
    }
    ${
      filters?.minScore !== undefined
        ? sql`AND COALESCE(leads.lead_score, 0) >= ${filters.minScore}`
        : sql``
    }
    ORDER BY COALESCE(leads.lead_score, 0) DESC, leads.last_enriched_at DESC
    LIMIT ${limit}
  `;

  const leads: LeadRow[] = [];
  for (const row of rows) {
    const data = parseEnrichedJson(row.enriched_json);
    // Belt-and-suspenders: SQL already gates ready / status / type before LIMIT.
    if (inventoryMode === "ready" && !isVerifiedDecisionMaker(data)) continue;
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
      best_contact_name: presentOrNull(data.best_contact_name),
      best_contact_role: presentOrNull(data.best_contact_role),
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

export async function getRelatedLeads(placeId: string): Promise<RelatedLead[]> {
  if (!dbAvailable()) return [];
  const sql = getSql();

  const leadRows = await sql`
    SELECT enriched_json, profile_key, mgmt_profile_key FROM leads WHERE place_id = ${placeId}
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
  const mgmtKey =
    (row.mgmt_profile_key as string | null) ??
    ((profileKey.startsWith("mgmt:") ? profileKey : "") || "");
  if (mgmtKey) {
    const mgrRows = await sql`
      SELECT place_id, business_name, city
      FROM leads
      WHERE (mgmt_profile_key = ${mgmtKey} OR profile_key = ${mgmtKey})
        AND place_id != ${placeId}
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
        detail: mgmtKey,
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

function classifyCostBilling(provider: string, operation: string): LeadCostBilling {
  if (provider === "browser_use") return "verified";
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
    const billing = classifyCostBilling(provider, operation);
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

  const leadType: LeadType = (row.category_key as string | null)?.startsWith("vendor_")
    ? "vendor"
    : "client";

  // Canonical provenance ledger (includes rejected extractions). Fall back to
  // enriched_json.facts for older rows that never wrote lead_facts.
  const [fbRows, factRows] = await Promise.all([
    sql`SELECT status FROM sales_feedback WHERE place_id = ${placeId}`,
    sql`
      SELECT fact_kind, value_json, source_kind, source_url, method, quote,
             verification, observed_at
      FROM lead_facts
      WHERE place_id = ${placeId}
      ORDER BY observed_at ASC NULLS LAST, id ASC
    `,
  ]);
  const crmStatus: CrmStatus = (fbRows[0]?.status as CrmStatus) || "New";
  const factsFromTable = factRows.map((f) => mapLeadFactRow(f as Record<string, unknown>));
  const factsFromJson = Array.isArray(data.facts)
    ? (data.facts as Record<string, unknown>[]).map((f) => mapLeadFactRecord(f))
    : [];
  const facts = (factsFromTable.length > 0 ? factsFromTable : factsFromJson).sort((a, b) => {
    const aRejected = a.verification === "rejected" ? 1 : 0;
    const bRejected = b.verification === "rejected" ? 1 : 0;
    return aRejected - bRejected;
  });

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
    address: addressParts.length > 0 ? addressParts.join(", ") : null,
    website: presentOrNull(data.website),
    google_maps_url: presentOrNull(data.google_maps_url),
    best_contact_name: presentOrNull(data.best_contact_name),
    best_contact_role: presentOrNull(data.best_contact_role),
    best_contact_phone: presentOrNull(data.best_contact_phone),
    best_contact_email_or_form: presentOrNull(data.best_contact_email_or_form),
    property_manager_clue: presentOrNull(data.property_manager_or_ownership_clue),
    why_now: presentOrNull(data.why_now),
    score_breakdown:
      data.score_breakdown && typeof data.score_breakdown === "object"
        ? (data.score_breakdown as Record<string, number>)
        : {},
    site_contacts: siteContacts,
    facts,
    evidence_urls: Array.isArray(data.evidence_urls)
      ? (data.evidence_urls as string[]).filter((u) => typeof u === "string" && u.trim())
      : [],
    notes: presentOrNull(data.notes),
    related: await getRelatedLeads(placeId),
    source_checks: await getSourceChecksForLead(placeId),
    costs: await getLeadCosts(placeId),
  };
});

function coerceFactValue(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value == null) continue;
    if (typeof value === "string") {
      out[key] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = String(value);
    }
  }
  return out;
}

function mapLeadFactRecord(f: Record<string, unknown>): LeadFact {
  return {
    fact_kind: String(f.fact_kind ?? ""),
    value: coerceFactValue(f.value ?? f.value_json),
    source_kind: String(f.source_kind ?? ""),
    source_url: String(f.source_url ?? ""),
    method: String(f.method ?? ""),
    quote: String(f.quote ?? ""),
    verification: String(f.verification ?? ""),
    observed_at: String(f.observed_at ?? ""),
  };
}

function mapLeadFactRow(row: Record<string, unknown>): LeadFact {
  let valueRaw: unknown = row.value_json;
  if (typeof valueRaw === "string") {
    try {
      valueRaw = JSON.parse(valueRaw);
    } catch {
      valueRaw = {};
    }
  }
  return mapLeadFactRecord({
    ...row,
    value: valueRaw,
  });
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
    duration_ms: row.duration_ms != null ? Number(row.duration_ms) : null,
    meta_json: row.meta_json ?? null,
    created_at: toIso(row.created_at),
  };
}

export async function getRunEvents(runId: string): Promise<RunEventRow[]> {
  if (!dbAvailable()) return [];
  const sql = getSql();

  const rows = await sql`
    SELECT id, run_id, place_id, stage, ran, reason, credits_est, duration_ms, meta_json, created_at
    FROM run_events
    WHERE run_id = ${runId}
    ORDER BY created_at ASC
  `;
  return rows.map((row) => mapRunEventRow(row as Record<string, unknown>));
}

export async function getRunCostEvents(runId: string) {
  if (!dbAvailable()) return [];
  const sql = getSql();

  const rows = await sql`
    SELECT id, provider, operation, units, unit_type, usd, place_id, model, meta_json, created_at
    FROM cost_events
    WHERE run_id = ${runId}
    ORDER BY created_at ASC
  `;
  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: Number(r.id),
      provider: String(r.provider),
      operation: String(r.operation),
      units: Number(r.units ?? 0),
      unit_type: String(r.unit_type ?? "units"),
      usd: Number(r.usd ?? 0),
      place_id: r.place_id != null ? String(r.place_id) : null,
      model: r.model != null ? String(r.model) : null,
      meta_json: r.meta_json ?? null,
      created_at: toIso(r.created_at),
    };
  });
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
  if (!dbAvailable()) return null;
  const sql = getSql();

  try {
    const rows = await sql`
      SELECT run_id, started_at, finished_at, run_type, market_key, category_key,
             campaign_key, job_id,
             discovered_count, skipped_known_count, enriched_count, status,
             stop_reason, stop_detail, error, verified_dm_count, duration_ms
      FROM runs
      WHERE run_id = ${runId}
    `;
    const row = rows[0];
    if (!row) return null;
    const mapped = mapRunRow(row as Record<string, unknown>);
    if (mapped.status !== "running") return mapped;
    const [hydrated] = await hydrateRunningCounters([mapped]);
    return hydrated;
  } catch {
    // Pre-migration fallback when observability columns are absent.
    const rows = await sql`
      SELECT run_id, started_at, finished_at, run_type, market_key, category_key,
             discovered_count, skipped_known_count, enriched_count, status
      FROM runs
      WHERE run_id = ${runId}
    `;
    const row = rows[0];
    if (!row) return null;
    return mapRunRow(row as Record<string, unknown>);
  }
}

export async function getRunCosts(runId: string): Promise<RunCosts> {
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
  const countRows = await sql`
    SELECT discovered_count, enriched_count
    FROM runs
    WHERE run_id = ${runId}
  `;
  const runLeadCount = Math.max(
    Number(countRows[0]?.discovered_count ?? 0),
    Number(countRows[0]?.enriched_count ?? 0),
  );
  const leadCount = Math.max(leadIds.size, runLeadCount);

  if (rows.length === 0) {
    return { ...emptyRunCosts(), firecrawlCreditsEst, leadCount };
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
    const usd = row.usd != null ? Number(row.usd) : 0;
    const provider = String(row.provider);
    const operation = String(row.operation);
    const billing = classifyCostBilling(provider, operation);
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
    leadCount,
    byProvider,
  };
}

function toTimelineStage(row: RunEventRow): RunTimelineStage {
  const meta =
    row.meta_json && typeof row.meta_json === "object" && !Array.isArray(row.meta_json)
      ? (row.meta_json as Record<string, unknown>)
      : {};
  const metaStage = typeof meta.stage === "string" ? meta.stage : null;
  const stage = metaStage || row.stage;
  return {
    stage,
    ran: row.ran === 1,
    reason: row.reason,
    credits_est: row.credits_est,
    created_at: row.created_at,
  };
}

export async function getRunTimeline(
  runId: string,
  preloadedEvents?: RunEventRow[],
): Promise<RunTimeline> {
  const events = preloadedEvents ?? (await getRunEvents(runId));
  const runEvents: RunTimelineStage[] = [];
  const leadMap = new Map<string, RunTimelineLead>();

  if (!dbAvailable()) {
    return { runEvents, leads: [] };
  }
  const sql = getSql();

  const placeIds = [
    ...new Set(
      events
        .map((row) => row.place_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  const leadMetaByPlace = new Map<
    string,
    {
      business_name: string | null;
      category_key: string | null;
      verification_level: string | null;
      lead_score: number | null;
    }
  >();
  if (placeIds.length > 0) {
    const leadRows = await sql`
      SELECT place_id, business_name, category_key, lead_score, enriched_json
      FROM leads WHERE place_id = ANY(${placeIds})
    `;
    for (const leadRow of leadRows) {
      const placeId = String(leadRow.place_id);
      let verificationLevel: string | null = null;
      if (leadRow.enriched_json) {
        const data = parseEnrichedJson(leadRow.enriched_json);
        verificationLevel =
          typeof data.verification_level === "string" ? data.verification_level : null;
      }
      leadMetaByPlace.set(placeId, {
        business_name:
          leadRow.business_name != null ? String(leadRow.business_name) : null,
        category_key: (leadRow.category_key as string | null) ?? null,
        verification_level: verificationLevel,
        lead_score: (leadRow.lead_score as number | null) ?? null,
      });
    }
  }

  for (const row of events) {
    if (!row.place_id) {
      runEvents.push(toTimelineStage(row));
      continue;
    }

    let lead = leadMap.get(row.place_id);
    if (!lead) {
      const metaRow = leadMetaByPlace.get(row.place_id);
      lead = {
        place_id: row.place_id,
        business_name: metaRow?.business_name ?? null,
        category_key: metaRow?.category_key ?? null,
        verification_level: metaRow?.verification_level ?? null,
        lead_score: metaRow?.lead_score ?? null,
        creditsEst: 0,
        done: false,
        stages: [],
      };
      leadMap.set(row.place_id, lead);
    }

    const stageRow = toTimelineStage(row);
    lead.stages.push(stageRow);
    lead.creditsEst += row.credits_est ?? 0;
    const meta =
      row.meta_json && typeof row.meta_json === "object" && !Array.isArray(row.meta_json)
        ? (row.meta_json as Record<string, unknown>)
        : {};
    const metaEvent = typeof meta.event === "string" ? meta.event : null;
    // Production + progress paths emit `lead_done` (not legacy `final`).
    if (
      isLeadFinishedStage(row.stage) ||
      isLeadFinishedStage(stageRow.stage) ||
      isLeadFinishedStage(metaEvent)
    ) {
      lead.done = true;
    }
  }

  return {
    runEvents,
    leads: [...leadMap.values()],
  };
}

export async function getRunDetail(runId: string): Promise<RunDetail | null> {
  const run = await getRun(runId);
  if (!run) return null;
  const studioEvents = await getRunEvents(runId);
  const studioCosts = await getRunCostEvents(runId);
  return {
    run,
    costs: await getRunCosts(runId),
    timeline: await getRunTimeline(runId, studioEvents),
    studioEvents,
    studioCosts,
  };
}

async function hydrateRunningCounters(runs: RunRow[]): Promise<RunRow[]> {
  const running = runs.filter((r) => r.status === "running");
  if (running.length === 0 || !dbAvailable()) return runs;
  const sql = getSql();
  const ids = running.map((r) => r.run_id);
  try {
    const live = await sql`
      SELECT
        r.run_id,
        COALESCE(
          (
            SELECT NULLIF(re.meta_json->>'count', '')::int
            FROM run_events re
            WHERE re.run_id = r.run_id
              AND (
                re.meta_json->>'event' = 'discovery_done'
                OR re.stage = 'discovery'
              )
            ORDER BY re.created_at DESC
            LIMIT 1
          ),
          r.discovered_count
        ) AS discovered_count,
        COALESCE(
          (
            SELECT NULLIF(re.meta_json->>'skipped_known', '')::int
            FROM run_events re
            WHERE re.run_id = r.run_id
              AND re.meta_json->>'skipped_known' IS NOT NULL
            ORDER BY re.created_at DESC
            LIMIT 1
          ),
          r.skipped_known_count
        ) AS skipped_known_count,
        GREATEST(
          r.enriched_count,
          (
            SELECT COUNT(DISTINCT re.place_id)::int
            FROM run_events re
            WHERE re.run_id = r.run_id
              AND re.place_id IS NOT NULL
              AND (
                re.meta_json->>'event' = 'lead_done'
                OR re.stage IN ('lead_done', 'final')
              )
          )
        ) AS enriched_count
      FROM runs r
      WHERE r.run_id = ANY(${ids})
        AND r.status = 'running'
    `;
    const byId = new Map(
      live.map((row) => [
        String(row.run_id),
        {
          discovered_count: Number(row.discovered_count ?? 0),
          skipped_known_count: Number(row.skipped_known_count ?? 0),
          enriched_count: Number(row.enriched_count ?? 0),
        },
      ]),
    );
    return runs.map((run) => {
      const overlay = byId.get(run.run_id);
      if (!overlay) return run;
      return { ...run, ...overlay };
    });
  } catch {
    return runs;
  }
}

export const listRuns = cache(async function listRuns(limit = 50): Promise<RunRow[]> {
  if (!dbAvailable()) return [];
  const sql = getSql();

  try {
    const rows = await sql`
      SELECT run_id, started_at, finished_at, run_type, market_key, category_key,
             campaign_key, job_id,
             discovered_count, skipped_known_count, enriched_count, status,
             stop_reason, stop_detail, error, verified_dm_count, duration_ms
      FROM runs
      ORDER BY started_at DESC
      LIMIT ${limit}
    `;
    return hydrateRunningCounters(rows.map((row) => mapRunRow(row as Record<string, unknown>)));
  } catch {
    // Pre-migration fallback when observability columns are absent.
    const rows = await sql`
      SELECT run_id, started_at, finished_at, run_type, market_key, category_key,
             discovered_count, skipped_known_count, enriched_count, status
      FROM runs
      ORDER BY started_at DESC
      LIMIT ${limit}
    `;
    return rows.map((row) => mapRunRow(row as Record<string, unknown>));
  }
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

/** Historical cost rollups — 30s is plenty between operator navigations. */
const costSeriesTtl = new Map<number, ReturnType<typeof createTtlCache<CostSeries>>>();

function costSeriesCache(days: number) {
  let entry = costSeriesTtl.get(days);
  if (!entry) {
    entry = createTtlCache<CostSeries>(30_000);
    costSeriesTtl.set(days, entry);
  }
  return entry;
}

export const getCostSeries = cache(async function getCostSeries(days = 30): Promise<CostSeries> {
  const ttl = costSeriesCache(days);
  const cached = ttl.get();
  if (cached) return cached;

  if (!dbAvailable()) {
    return {
      byDay: [],
      byProvider: [],
      byOperation: [],
      byRun: [],
      byModel: [],
      byMarket: [],
      byHour: [],
      budget: null,
      balances: [],
    };
  }
  const sql = getSql();

  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceDate = since.toISOString().slice(0, 10);
  const sinceIso = since.toISOString();

  const [
    byDayRows,
    providerRows,
    byOperationRows,
    byRunRows,
    byModelRows,
    byMarketRows,
    byHourRows,
    snapshotRows,
    balances,
  ] = await Promise.all([
    sql`
      SELECT date,
             usd,
             firecrawl_credits,
             browser_use_usd,
             google_places_usd
      FROM cost_by_day
      WHERE date >= ${sinceDate}
      ORDER BY date
    `,
    sql`
      SELECT provider, unit_type,
             COALESCE(SUM(usd), 0)::float AS usd,
             COALESCE(SUM(units), 0)::float AS units,
             COUNT(*)::bigint AS event_count
      FROM cost_events
      WHERE created_at >= ${sinceIso}
      GROUP BY provider, unit_type
      ORDER BY usd DESC
    `,
    sql`
      SELECT provider, operation, unit_type,
             COALESCE(SUM(usd), 0)::float AS usd,
             COUNT(*)::int AS count
      FROM cost_events
      WHERE created_at >= ${sinceIso}
      GROUP BY provider, operation, unit_type
      ORDER BY usd DESC
      LIMIT 20
    `,
    sql`
      SELECT run_id, started_at, finished_at, run_type, market_key, category_key,
             enriched_count, status, usd, firecrawl_credits, event_count, usd_per_enriched_lead
      FROM cost_by_run
      WHERE started_at >= ${sinceIso}
      ORDER BY started_at DESC
      LIMIT 50
    `,
    sql`
      SELECT provider, model, operation, unit_type, units, usd, event_count
      FROM cost_by_model
      ORDER BY usd DESC
      LIMIT 30
    `,
    sql`
      SELECT market_key, category_key, usd, firecrawl_credits, run_count, event_count
      FROM cost_by_market
      ORDER BY usd DESC
      LIMIT 30
    `,
    sql`
      SELECT hour, usd, firecrawl_credits, event_count
      FROM cost_by_hour
      ORDER BY hour
    `,
    sql`
      SELECT snapshot_json
      FROM credit_snapshots
      WHERE provider = 'firecrawl'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    getCreditBalances(),
  ]);

  const byDay = byDayRows.map((row) => ({
    date: String(row.date),
    usd: Number(row.usd),
    firecrawlCredits: Number(row.firecrawl_credits),
    browserUseUsd: Number(row.browser_use_usd),
    googlePlacesUsd: Number(row.google_places_usd),
  }));

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

  const firecrawlBalance = balances.find((b) => b.provider === "firecrawl");

  return ttl.set({
    byDay,
    byProvider,
    byOperation: byOperationRows.map((row) => ({
      provider: String(row.provider),
      operation: String(row.operation),
      usd: Number(row.usd),
      count: Number(row.count),
      unitType: String(row.unit_type),
    })),
    byRun: byRunRows.map((row) => ({
      runId: String(row.run_id),
      startedAt: toIso(row.started_at),
      finishedAt: toIsoOrNull(row.finished_at),
      runType: String(row.run_type),
      marketKey: row.market_key != null ? String(row.market_key) : null,
      categoryKey: row.category_key != null ? String(row.category_key) : null,
      enrichedCount: Number(row.enriched_count),
      status: String(row.status),
      usd: Number(row.usd),
      firecrawlCredits: Number(row.firecrawl_credits),
      eventCount: Number(row.event_count),
      usdPerEnrichedLead:
        row.usd_per_enriched_lead != null ? Number(row.usd_per_enriched_lead) : null,
    })),
    byModel: byModelRows.map((row) => ({
      provider: String(row.provider),
      model: String(row.model),
      operation: String(row.operation),
      unitType: String(row.unit_type),
      units: Number(row.units),
      usd: Number(row.usd),
      eventCount: Number(row.event_count),
    })),
    byMarket: byMarketRows.map((row) => ({
      marketKey: row.market_key != null ? String(row.market_key) : null,
      categoryKey: row.category_key != null ? String(row.category_key) : null,
      usd: Number(row.usd),
      firecrawlCredits: Number(row.firecrawl_credits),
      runCount: Number(row.run_count),
      eventCount: Number(row.event_count),
    })),
    byHour: byHourRows.map((row) => ({
      hour: toIso(row.hour),
      usd: Number(row.usd),
      firecrawlCredits: Number(row.firecrawl_credits),
      eventCount: Number(row.event_count),
    })),
    budget: buildCostBudget(
      firecrawlBalance,
      byDay,
      snapshotRows[0]?.snapshot_json,
    ),
    balances,
  });
});

export const listFilterOptions = cache(async function listFilterOptions(): Promise<{
  markets: string[];
  categories: string[];
}> {
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

export async function getLeadOutcome(placeId: string): Promise<LeadOutcome | null> {
  if (!dbAvailable()) return null;
  const sql = getSql();
  let rows;
  try {
    // Prefer non-auto lead_outcomes, then latest partner outcome, then auto.
    rows = await sql`
      SELECT place_id, outcome, outcome_reason, deal_value_usd, quality_rating,
             data_flags, source, notes, decided_at
      FROM (
        SELECT place_id, outcome, outcome_reason, deal_value_usd, quality_rating,
               data_flags, source, notes, decided_at,
               case when source = 'auto' then 2 else 0 end as source_rank
        FROM lead_outcomes
        WHERE place_id = ${placeId}
        UNION ALL
        SELECT place_id, outcome, outcome_reason, deal_value_usd, quality_rating,
               data_flags, 'partner_api'::text as source, notes, decided_at,
               1 as source_rank
        FROM partner_lead_outcomes
        WHERE place_id = ${placeId}
      ) x
      ORDER BY source_rank ASC, decided_at DESC NULLS LAST
      LIMIT 1
    `;
  } catch {
    return null;
  }
  const row = rows[0];
  if (!row) return null;
  return {
    place_id: String(row.place_id),
    outcome: String(row.outcome) as LeadOutcome["outcome"],
    outcome_reason: row.outcome_reason as LeadOutcome["outcome_reason"],
    deal_value_usd: row.deal_value_usd != null ? Number(row.deal_value_usd) : null,
    quality_rating: row.quality_rating != null ? Number(row.quality_rating) : null,
    data_flags:
      row.data_flags && typeof row.data_flags === "object"
        ? (row.data_flags as Record<string, boolean>)
        : {},
    source: String(row.source),
    notes: row.notes != null ? String(row.notes) : null,
    decided_at: toIso(row.decided_at),
  };
}

export async function listLeadTouches(placeId: string, limit = 50): Promise<LeadTouch[]> {
  if (!dbAvailable()) return [];
  const sql = getSql();
  let rows;
  try {
    rows = await sql`
      SELECT id, place_id, touch_type, result, contact_name, contact_phone,
             duration_seconds, source, notes, occurred_at
      FROM lead_touches
      WHERE place_id = ${placeId}
      ORDER BY occurred_at DESC
      LIMIT ${limit}
    `;
  } catch {
    return [];
  }
  return rows.map((row) => ({
    id: Number(row.id),
    place_id: String(row.place_id),
    touch_type: String(row.touch_type) as LeadTouch["touch_type"],
    result: row.result as LeadTouch["result"],
    contact_name: row.contact_name != null ? String(row.contact_name) : null,
    contact_phone: row.contact_phone != null ? String(row.contact_phone) : null,
    duration_seconds: row.duration_seconds != null ? Number(row.duration_seconds) : null,
    source: String(row.source),
    notes: row.notes != null ? String(row.notes) : null,
    occurred_at: toIso(row.occurred_at),
  }));
}

export const getLatestInsightReport = cache(async function getLatestInsightReport(): Promise<InsightReport | null> {
  if (!dbAvailable()) return null;
  const sql = getSql();
  let rows;
  try {
    rows = await sql`
      SELECT id, created_at, sample_size, labeled_count, report_json, model_metrics
      FROM insight_reports
      ORDER BY created_at DESC
      LIMIT 1
    `;
  } catch {
    return null;
  }
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    created_at: toIso(row.created_at),
    sample_size: Number(row.sample_size),
    labeled_count: Number(row.labeled_count),
    report_json:
      row.report_json && typeof row.report_json === "object"
        ? (row.report_json as Record<string, unknown>)
        : {},
    model_metrics:
      row.model_metrics && typeof row.model_metrics === "object"
        ? (row.model_metrics as Record<string, unknown>)
        : null,
  };
});

export async function getFeatureOutcomeStats(): Promise<{
  winRateByCategory: { bucket: string; wins: number; total: number; smoothed_win_rate: number }[];
  winRateByMarket: { bucket: string; wins: number; total: number; smoothed_win_rate: number }[];
}> {
  if (!dbAvailable()) return { winRateByCategory: [], winRateByMarket: [] };
  const sql = getSql();
  let categoryRows;
  let marketRows;
  try {
    categoryRows = await sql`
      SELECT COALESCE(features->>'category_key', 'unknown') AS bucket,
             SUM(CASE WHEN label_good = 1 THEN 1 ELSE 0 END)::int AS wins,
             COUNT(*) FILTER (WHERE label_good IS NOT NULL)::int AS total
      FROM feature_outcomes
      GROUP BY 1
      HAVING COUNT(*) FILTER (WHERE label_good IS NOT NULL) > 0
      ORDER BY total DESC
      LIMIT 20
    `;
    marketRows = await sql`
      SELECT COALESCE(features->>'market_key', 'unknown') AS bucket,
             SUM(CASE WHEN label_good = 1 THEN 1 ELSE 0 END)::int AS wins,
             COUNT(*) FILTER (WHERE label_good IS NOT NULL)::int AS total
      FROM feature_outcomes
      GROUP BY 1
      HAVING COUNT(*) FILTER (WHERE label_good IS NOT NULL) > 0
      ORDER BY total DESC
      LIMIT 20
    `;
  } catch {
    return { winRateByCategory: [], winRateByMarket: [] };
  }
  const alpha = 2;
  const smooth = (wins: number, total: number) => (wins + alpha) / (total + 2 * alpha);
  return {
    winRateByCategory: categoryRows.map((row) => ({
      bucket: String(row.bucket),
      wins: Number(row.wins),
      total: Number(row.total),
      smoothed_win_rate: smooth(Number(row.wins), Number(row.total)),
    })),
    winRateByMarket: marketRows.map((row) => ({
      bucket: String(row.bucket),
      wins: Number(row.wins),
      total: Number(row.total),
      smoothed_win_rate: smooth(Number(row.wins), Number(row.total)),
    })),
  };
}

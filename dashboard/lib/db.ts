import Database from "better-sqlite3";
import { existsSync } from "fs";
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
import { dbPath } from "./paths";

let _db: Database.Database | null = null;
let _missing = false;

export function dbAvailable(): boolean {
  return existsSync(dbPath());
}

export function getDb(): Database.Database {
  if (_missing) {
    throw new Error("Database not found. Run pallares-leads first.");
  }
  if (!_db) {
    const resolved = dbPath();
    if (!existsSync(resolved)) {
      _missing = true;
      throw new Error("Database not found. Run pallares-leads first.");
    }
    _db = new Database(resolved, { readonly: true });
    _db.pragma("busy_timeout = 60000");
  }
  return _db;
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

function parseFirecrawlSnapshotBalance(
  snapshotJson: string | null,
  remaining: number | null,
  used: number | null,
): { remaining: number | null; used: number | null } {
  if (remaining != null) {
    return { remaining, used };
  }
  if (!snapshotJson) {
    return { remaining: null, used: null };
  }
  try {
    const payload = JSON.parse(snapshotJson) as Record<string, unknown>;
    const data =
      payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
        ? (payload.data as Record<string, unknown>)
        : payload;
    const remRaw = data.remainingCredits ?? data.remaining_credits;
    const planRaw = data.planCredits ?? data.plan_credits;
    let usedRaw = data.usedCredits ?? data.used_credits;
    if (usedRaw == null && remRaw != null && planRaw != null) {
      usedRaw = Number(planRaw) - Number(remRaw);
    }
    return {
      remaining: remRaw != null ? Number(remRaw) : null,
      used: usedRaw != null ? Number(usedRaw) : null,
    };
  } catch {
    return { remaining: null, used: null };
  }
}

export function getCreditBalances(): ProviderBalance[] {
  if (!dbAvailable()) return [];
  const db = getDb();
  if (!tableExists(db, "credit_snapshots")) return [];

  const rows = db
    .prepare(
      `SELECT provider, remaining_credits, used_credits, snapshot_json, created_at
       FROM credit_snapshots cs
       WHERE created_at = (
         SELECT MAX(created_at)
         FROM credit_snapshots
         WHERE provider = cs.provider
       )
       ORDER BY provider`,
    )
    .all() as {
    provider: string;
    remaining_credits: number | null;
    used_credits: number | null;
    snapshot_json: string | null;
    created_at: string;
  }[];

  return rows.map((row) => {
    const parsed =
      row.provider === "firecrawl"
        ? parseFirecrawlSnapshotBalance(
            row.snapshot_json,
            row.remaining_credits,
            row.used_credits,
          )
        : { remaining: row.remaining_credits, used: row.used_credits };
    return {
      provider: row.provider,
      remaining: parsed.remaining,
      used: parsed.used,
      unitLabel: balanceUnitLabel(row.provider),
      snapshotAt: row.created_at,
    };
  });
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return Boolean(row);
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((r) => r.name === column);
}

type EnrichedJson = {
  investigation_status?: string;
  verification_level?: string;
  main_phone?: string | null;
  site_contacts?: { phone?: string; email?: string }[];
  best_contact_phone?: string;
  best_contact_email_or_form?: string;
  facts?: unknown[];
};

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

export function getOverview(): OverviewStats {
  if (!dbAvailable()) return emptyOverview();
  const db = getDb();
  const totalLeads = (
    db.prepare("SELECT COUNT(*) AS n FROM leads").get() as { n: number }
  ).n;
  const enrichedQuery = hasColumn(db, "leads", "enriched_json")
    ? "SELECT COUNT(*) AS n FROM leads WHERE enriched_json IS NOT NULL"
    : "SELECT COUNT(*) AS n FROM leads WHERE last_enriched_at IS NOT NULL";
  const enrichedLeads = (db.prepare(enrichedQuery).get() as { n: number }).n;

  let readyToCall = 0;
  if (hasColumn(db, "leads", "enriched_json")) {
    const rows = db
      .prepare("SELECT enriched_json FROM leads WHERE enriched_json IS NOT NULL")
      .all() as { enriched_json: string }[];
    for (const row of rows) {
      try {
        const data = JSON.parse(row.enriched_json) as EnrichedJson;
        if (isReadyToCall(data)) readyToCall += 1;
      } catch {
        // skip malformed
      }
    }
  }

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthIso = monthStart.toISOString();

  let creditsThisMonth = 0;
  let browserUseUsdThisMonth = 0;
  let aiGatewayUsdThisMonth = 0;
  let usdByProvider: OverviewStats["usdByProvider"] = [];
  if (tableExists(db, "cost_events")) {
    const creditsRow = db
      .prepare(
        `SELECT COALESCE(SUM(units), 0) AS credits
         FROM cost_events
         WHERE provider = 'firecrawl'
           AND created_at >= ?`,
      )
      .get(monthIso) as { credits: number };
    creditsThisMonth = creditsRow.credits;

    const browserUseRow = db
      .prepare(
        `SELECT COALESCE(SUM(usd), 0) AS usd
         FROM cost_events
         WHERE provider = 'browser_use'
           AND created_at >= ?`,
      )
      .get(monthIso) as { usd: number };
    browserUseUsdThisMonth = browserUseRow.usd;

    const aiGatewayRow = db
      .prepare(
        `SELECT COALESCE(SUM(usd), 0) AS usd
         FROM cost_events
         WHERE provider = 'ai_gateway'
           AND created_at >= ?`,
      )
      .get(monthIso) as { usd: number };
    aiGatewayUsdThisMonth = aiGatewayRow.usd;

    const providerRows = db
      .prepare(
        `SELECT provider,
                unit_type,
                COALESCE(SUM(usd), 0) AS usd,
                COALESCE(SUM(units), 0) AS units,
                COUNT(*) AS count
         FROM cost_events
         WHERE created_at >= ?
         GROUP BY provider, unit_type
         ORDER BY usd DESC`,
      )
      .all(monthIso) as {
      provider: string;
      unit_type: string;
      usd: number;
      units: number;
      count: number;
    }[];

    const merged = new Map<string, OverviewStats["usdByProvider"][number]>();
    for (const row of providerRows) {
      const existing = merged.get(row.provider);
      if (existing) {
        existing.usd += row.usd;
        existing.units += row.units;
      } else {
        merged.set(row.provider, {
          provider: row.provider,
          usd: row.usd,
          units: row.units,
          unitType: row.unit_type,
        });
      }
    }
    usdByProvider = [...merged.values()].sort((a, b) => b.usd - a.usd);
  }

  return {
    totalLeads,
    enrichedLeads,
    readyToCall,
    readyToCallRate: enrichedLeads > 0 ? readyToCall / enrichedLeads : 0,
    creditsThisMonth,
    browserUseUsdThisMonth,
    aiGatewayUsdThisMonth,
    usdByProvider,
    balances: getCreditBalances(),
  };
}

export function listLeads(filters?: {
  market?: string;
  category?: string;
  status?: string;
  crmStatus?: string;
  type?: string;
  minScore?: number;
  dudsOnly?: boolean;
  limit?: number;
}): LeadRow[] {
  if (!dbAvailable()) return [];
  const db = getDb();
  const clauses: string[] = [];
  if (tableExists(db, "leads") && hasColumn(db, "leads", "enriched_json")) {
    clauses.push("enriched_json IS NOT NULL");
  } else if (tableExists(db, "leads")) {
    clauses.push("last_enriched_at IS NOT NULL");
  } else {
    return [];
  }
  const params: (string | number)[] = [];

  if (filters?.market) {
    clauses.push("market_key = ?");
    params.push(filters.market);
  }
  if (filters?.category) {
    clauses.push("category_key = ?");
    params.push(filters.category);
  }
  if (filters?.minScore !== undefined && hasColumn(db, "leads", "lead_score")) {
    clauses.push("COALESCE(lead_score, 0) >= ?");
    params.push(filters.minScore);
  }
  if (filters?.dudsOnly) {
    const dudParts: string[] = [
      "enrichment_status = 'needs_manual'",
      "confidence = 'Low'",
      "enrichment_status = 'unverified'",
    ];
    if (hasColumn(db, "leads", "lead_score")) {
      dudParts.unshift("COALESCE(lead_score, 0) < 40");
    }
    clauses.push(`(${dudParts.join(" OR ")})`);
  }

  const limit = filters?.limit ?? 500;
  const hasEnrichedJson = hasColumn(db, "leads", "enriched_json");
  const hasLeadScore = hasColumn(db, "leads", "lead_score");
  const hasSalesFeedback = tableExists(db, "sales_feedback");
  const hasCrmStatus =
    hasSalesFeedback && hasColumn(db, "sales_feedback", "status");
  const crmJoin = hasCrmStatus
    ? "LEFT JOIN sales_feedback sf ON sf.place_id = leads.place_id"
    : "";
  const crmStatusCol = hasCrmStatus ? ", COALESCE(sf.status, 'New') AS crm_status" : ", 'New' AS crm_status";
  const enrichedCol = hasEnrichedJson ? ", enriched_json" : "";
  const orderScore = hasLeadScore ? "COALESCE(lead_score, 0) DESC," : "";
  const sql = `
    SELECT place_id, business_name, market_key, category_key, city,
           last_enriched_at, enrichment_status, confidence
           ${hasLeadScore ? ", lead_score" : ""}${enrichedCol}${crmStatusCol}
    FROM leads
    ${crmJoin}
    WHERE ${clauses.join(" AND ")}
    ORDER BY ${orderScore} last_enriched_at DESC
    LIMIT ?
  `;
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];

  const leads: LeadRow[] = [];
  for (const row of rows) {
    let data: EnrichedJson = {};
    const enrichedJson = row.enriched_json as string | undefined;
    if (enrichedJson) {
      try {
        data = JSON.parse(enrichedJson) as EnrichedJson;
      } catch {
        data = {};
      }
    }
    const status = salesStatus(data);
    if (filters?.status && status !== filters.status) continue;
    const crmStatus = (row.crm_status as string) ?? "New";
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
      last_enriched_at: (row.last_enriched_at as string | null) ?? null,
      enrichment_status: (row.enrichment_status as string | null) ?? null,
      confidence: (row.confidence as string | null) ?? null,
      verification_level:
        typeof data.verification_level === "string"
          ? data.verification_level
          : null,
      lead_score: hasLeadScore ? ((row.lead_score as number | null) ?? null) : null,
      status,
      crm_status: crmStatus as CrmStatus,
      lead_type: leadType,
      phone: primaryPhone(data),
    });
  }
  return leads;
}

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

export function getRelatedLeads(placeId: string): RelatedLead[] {
  if (!dbAvailable()) return [];
  const db = getDb();
  const row = db
    .prepare("SELECT enriched_json, profile_key FROM leads WHERE place_id = ?")
    .get(placeId) as { enriched_json?: string; profile_key?: string } | undefined;
  if (!row) return [];

  let domain = "";
  if (row.enriched_json) {
    try {
      const data = JSON.parse(row.enriched_json) as { website?: string };
      const website = data.website ?? "";
      if (website) {
        try {
          domain = new URL(website).hostname.replace(/^www\./, "");
        } catch {
          domain = "";
        }
      }
    } catch {
      /* ignore */
    }
  }

  const related: RelatedLead[] = [];
  const seen = new Set<string>([placeId]);

  const owner = db
    .prepare(
      "SELECT owner_name_normalized, owner_name FROM owner_records WHERE place_id = ?",
    )
    .get(placeId) as
    | { owner_name_normalized?: string; owner_name?: string }
    | undefined;

  if (owner?.owner_name_normalized) {
    const rows = db
      .prepare(
        `SELECT l.place_id, l.business_name, l.city, o.owner_name
         FROM owner_records o JOIN leads l ON l.place_id = o.place_id
         WHERE o.owner_name_normalized = ? AND o.place_id != ? LIMIT 10`,
      )
      .all(owner.owner_name_normalized, placeId) as {
      place_id: string;
      business_name: string;
      city: string | null;
      owner_name: string;
    }[];
    for (const r of rows) {
      if (seen.has(r.place_id)) continue;
      seen.add(r.place_id);
      related.push({
        place_id: r.place_id,
        business_name: r.business_name,
        city: r.city,
        relation: "same_owner",
        detail: r.owner_name,
      });
    }
  }

  const profileKey = row.profile_key ?? "";
  if (profileKey.startsWith("mgmt:")) {
    const rows = db
      .prepare(
        "SELECT place_id, business_name, city FROM leads WHERE profile_key = ? AND place_id != ? LIMIT 10",
      )
      .all(profileKey, placeId) as {
      place_id: string;
      business_name: string;
      city: string | null;
    }[];
    for (const r of rows) {
      if (seen.has(r.place_id)) continue;
      seen.add(r.place_id);
      related.push({
        place_id: r.place_id,
        business_name: r.business_name,
        city: r.city,
        relation: "same_manager",
        detail: profileKey,
      });
    }
  }

  if (domain) {
    const rows = db
      .prepare(
        "SELECT place_id, business_name, city FROM leads WHERE place_id != ? AND enriched_json LIKE ? LIMIT 10",
      )
      .all(placeId, `%${domain}%`) as {
      place_id: string;
      business_name: string;
      city: string | null;
    }[];
    for (const r of rows) {
      if (seen.has(r.place_id)) continue;
      seen.add(r.place_id);
      related.push({
        place_id: r.place_id,
        business_name: r.business_name,
        city: r.city,
        relation: "same_domain",
        detail: domain,
      });
    }
  }

  return related.slice(0, 10);
}

export function getSourceChecksForLead(placeId: string): SourceCheck[] {
  if (!dbAvailable()) return [];
  const db = getDb();
  if (!tableExists(db, "run_events")) return [];

  const rows = db
    .prepare(
      `SELECT stage, ran, reason FROM run_events
       WHERE place_id = ? AND stage LIKE 'source_check:%'
       ORDER BY created_at DESC LIMIT 30`,
    )
    .all(placeId) as { stage: string; ran: number; reason: string | null }[];

  const seen = new Set<string>();
  const checks: SourceCheck[] = [];
  for (const row of rows) {
    const sourceKey = row.stage.replace("source_check:", "");
    if (seen.has(sourceKey)) continue;
    seen.add(sourceKey);
    const reason = row.reason ?? "";
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
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function getLeadCosts(placeId: string): LeadCosts {
  if (!dbAvailable()) return emptyLeadCosts();
  const db = getDb();
  if (!tableExists(db, "cost_events")) return emptyLeadCosts();

  const rows = db
    .prepare(
      `SELECT id, run_id, request_id, provider, operation, units, unit_type,
              usd, model, meta_json, created_at
       FROM cost_events
       WHERE place_id = ?
       ORDER BY created_at ASC, id ASC`,
    )
    .all(placeId) as {
    id: number;
    run_id: string | null;
    request_id: string | null;
    provider: string;
    operation: string;
    units: number;
    unit_type: string;
    usd: number | null;
    model: string | null;
    meta_json: string | null;
    created_at: string;
  }[];

  let firecrawlCreditsEst = 0;
  if (tableExists(db, "run_events")) {
    const creditsRow = db
      .prepare(
        `SELECT COALESCE(SUM(credits_est), 0) AS total
         FROM run_events WHERE place_id = ?`,
      )
      .get(placeId) as { total: number } | undefined;
    firecrawlCreditsEst = creditsRow?.total ?? 0;
  }

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
    const usd = row.usd ?? 0;
    const billing = classifyCostBilling(row.provider, row.operation, meta);
    const event: LeadCostEvent = {
      id: row.id,
      runId: row.run_id,
      requestId: row.request_id,
      provider: row.provider,
      operation: row.operation,
      units: row.units,
      unitType: row.unit_type,
      usd,
      model: row.model,
      meta,
      createdAt: row.created_at,
      billing,
    };
    events.push(event);
    totalUsd += usd;
    if (billing === "verified") verifiedUsd += usd;
    else estimatedUsd += usd;

    const bucket = providerBuckets.get(row.provider);
    if (bucket) {
      bucket.usdTotal += usd;
      bucket.unitsTotal += row.units;
      bucket.eventCount += 1;
      if (billing === "verified") bucket.verifiedUsd += usd;
      else bucket.estimatedUsd += usd;
      bucket.events.push(event);
    } else {
      providerBuckets.set(row.provider, {
        provider: row.provider,
        usdTotal: usd,
        unitsTotal: row.units,
        unitType: row.unit_type,
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

export function getLeadDetail(placeId: string): LeadDetail | null {
  if (!dbAvailable()) return null;
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM leads WHERE place_id = ?")
    .get(placeId) as Record<string, unknown> | undefined;
  if (!row) return null;

  let data: Record<string, unknown> = {};
  if (typeof row.enriched_json === "string") {
    try {
      data = JSON.parse(row.enriched_json) as Record<string, unknown>;
    } catch {
      data = {};
    }
  }
  const enriched = data as EnrichedJson;

  const rawContacts = Array.isArray(data.site_contacts)
    ? (data.site_contacts as Record<string, unknown>[])
    : [];
  // Python SiteContact fields: label, name, phone, email, priority, source_url, verification, quote
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

  let crmStatus: CrmStatus = "New";
  if (tableExists(db, "sales_feedback") && hasColumn(db, "sales_feedback", "status")) {
    const fb = db
      .prepare("SELECT status FROM sales_feedback WHERE place_id = ?")
      .get(placeId) as { status: string | null } | undefined;
    crmStatus = (fb?.status as CrmStatus) || "New";
  }
  const leadType: LeadType = (row.category_key as string | null)?.startsWith("vendor_")
    ? "vendor"
    : "client";

  return {
    place_id: String(row.place_id),
    business_name: String(
      data.business_name ?? row.business_name ?? "Unknown",
    ),
    market_key: (row.market_key as string | null) ?? null,
    category_key: (row.category_key as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    last_enriched_at: (row.last_enriched_at as string | null) ?? null,
    enrichment_status: (row.enrichment_status as string | null) ?? null,
    confidence: (row.confidence as string | null) ?? null,
    verification_level:
      typeof data.verification_level === "string"
        ? data.verification_level
        : null,
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
    property_manager_clue: presentOrNull(
      data.property_manager_or_ownership_clue,
    ),
    why_good_fit: presentOrNull(data.why_this_is_a_good_fit),
    why_now: presentOrNull(data.why_now),
    score_breakdown:
      data.score_breakdown && typeof data.score_breakdown === "object"
        ? (data.score_breakdown as Record<string, number>)
        : {},
    talking_points: normalizeListText(presentOrNull(data.sales_talking_points)),
    need_signals: normalizeListText(
      presentOrNull(data.exterior_cleaning_need_signals),
    ),
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
      ? (data.evidence_urls as string[]).filter(
          (u) => typeof u === "string" && u.trim(),
        )
      : [],
    notes: presentOrNull(data.notes),
    related: getRelatedLeads(placeId),
    source_checks: getSourceChecksForLead(placeId),
    costs: getLeadCosts(placeId),
  };
}

export function getRunEvents(runId: string): RunEventRow[] {
  if (!dbAvailable()) return [];
  const db = getDb();
  if (!tableExists(db, "run_events")) return [];
  return db
    .prepare(
      `SELECT id, run_id, place_id, stage, ran, reason, credits_est, created_at
       FROM run_events
       WHERE run_id = ?
       ORDER BY created_at ASC`,
    )
    .all(runId) as RunEventRow[];
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

export function getRun(runId: string): RunRow | null {
  if (!dbAvailable()) return null;
  const db = getDb();
  const stmt = db.prepare(
    `SELECT run_id, started_at, finished_at, run_type, market_key, category_key,
            discovered_count, skipped_known_count, enriched_count, status
     FROM runs
     WHERE run_id = ?`,
  );
  const row = stmt.get(runId);
  if (!row) return null;
  return row as RunRow;
}

export function getRunCosts(runId: string): RunCosts {
  if (!dbAvailable()) return emptyRunCosts();
  const db = getDb();
  if (!tableExists(db, "cost_events")) return emptyRunCosts();

  const rows = db
    .prepare(
      `SELECT provider, operation, units, unit_type, usd, meta_json, place_id
       FROM cost_events
       WHERE run_id = ?
       ORDER BY created_at ASC, id ASC`,
    )
    .all(runId) as {
    provider: string;
    operation: string;
    units: number;
    unit_type: string;
    usd: number | null;
    meta_json: string | null;
    place_id: string | null;
  }[];

  let firecrawlCreditsEst = 0;
  if (tableExists(db, "run_events")) {
    const creditsRow = db
      .prepare(
        `SELECT COALESCE(SUM(credits_est), 0) AS total
         FROM run_events WHERE run_id = ?`,
      )
      .get(runId) as { total: number } | undefined;
    firecrawlCreditsEst = creditsRow?.total ?? 0;
  }

  const leadIds = new Set<string>();
  for (const row of rows) {
    if (row.place_id) leadIds.add(row.place_id);
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
    if (row.place_id) leadIds.add(row.place_id);
    const meta = parseCostMeta(row.meta_json);
    const usd = row.usd ?? 0;
    const billing = classifyCostBilling(row.provider, row.operation, meta);
    totalUsd += usd;
    if (billing === "verified") verifiedUsd += usd;
    else estimatedUsd += usd;

    let bucket = providerBuckets.get(row.provider);
    if (!bucket) {
      bucket = {
        provider: row.provider,
        usdTotal: 0,
        unitsTotal: 0,
        unitType: row.unit_type,
        eventCount: 0,
        verifiedUsd: 0,
        estimatedUsd: 0,
        operations: [],
        opMap: new Map(),
      };
      providerBuckets.set(row.provider, bucket);
    }
    bucket.usdTotal += usd;
    bucket.unitsTotal += row.units;
    bucket.eventCount += 1;
    if (billing === "verified") bucket.verifiedUsd += usd;
    else bucket.estimatedUsd += usd;

    const opKey = `${row.operation}:${row.unit_type}`;
    let op = bucket.opMap.get(opKey);
    if (!op) {
      op = {
        operation: row.operation,
        usd: 0,
        units: 0,
        unitType: row.unit_type,
        count: 0,
        billing,
      };
      bucket.opMap.set(opKey, op);
      bucket.operations.push(op);
    }
    op.usd += usd;
    op.units += row.units;
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

export function getRunTimeline(runId: string): RunTimeline {
  const events = getRunEvents(runId);
  const runEvents: RunTimelineStage[] = [];
  const leadMap = new Map<string, RunTimelineLead>();

  if (!dbAvailable()) {
    return { runEvents, leads: [] };
  }
  const db = getDb();

  for (const row of events) {
    if (!row.place_id) {
      runEvents.push(toTimelineStage(row));
      continue;
    }

    let lead = leadMap.get(row.place_id);
    if (!lead) {
      const leadRow = db
        .prepare(
          `SELECT business_name, category_key, lead_score, enriched_json
           FROM leads WHERE place_id = ?`,
        )
        .get(row.place_id) as
        | {
            business_name: string;
            category_key: string | null;
            lead_score: number | null;
            enriched_json: string | null;
          }
        | undefined;

      let verificationLevel: string | null = null;
      if (leadRow?.enriched_json) {
        try {
          const data = JSON.parse(leadRow.enriched_json) as { verification_level?: string };
          verificationLevel = data.verification_level ?? null;
        } catch {
          verificationLevel = null;
        }
      }

      lead = {
        place_id: row.place_id,
        business_name: leadRow?.business_name ?? null,
        category_key: leadRow?.category_key ?? null,
        verification_level: verificationLevel,
        lead_score: leadRow?.lead_score ?? null,
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

export function getRunDetail(runId: string): RunDetail | null {
  const run = getRun(runId);
  if (!run) return null;
  return {
    run,
    costs: getRunCosts(runId),
    timeline: getRunTimeline(runId),
  };
}

export function listRuns(limit = 50): RunRow[] {
  if (!dbAvailable()) return [];
  const db = getDb();
  return db
    .prepare(
      `SELECT run_id, started_at, finished_at, run_type, market_key, category_key,
              discovered_count, skipped_known_count, enriched_count, status
       FROM runs
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(limit) as RunRow[];
}

export function listRequests(limit = 50): RequestRow[] {
  if (!dbAvailable()) return [];
  const db = getDb();
  if (!tableExists(db, "lead_requests")) return [];
  const rows = db
    .prepare(
      `SELECT request_id, created_at, raw_prompt, spec_json, status,
              leads_delivered, credits_spent, usd_spent
       FROM lead_requests
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(limit) as {
    request_id: string;
    created_at: string;
    raw_prompt: string;
    spec_json: string;
    status: string;
    leads_delivered: number;
    credits_spent: number;
    usd_spent: number | null;
  }[];

  return rows.map((row) => ({
    request_id: row.request_id,
    created_at: row.created_at,
    raw_prompt: row.raw_prompt,
    status: row.status,
    leads_delivered: row.leads_delivered,
    credits_spent: row.credits_spent,
    usd_spent: row.usd_spent,
    spec: JSON.parse(row.spec_json) as Record<string, unknown>,
  }));
}

export function getCostSeries(days = 30): CostSeries {
  if (!dbAvailable()) {
    return { byDay: [], byProvider: [], byOperation: [], balances: [] };
  }
  const db = getDb();
  if (!tableExists(db, "cost_events")) {
    return { byDay: [], byProvider: [], byOperation: [], balances: getCreditBalances() };
  }
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceIso = since.toISOString();

  const byDay = db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS date,
              COALESCE(SUM(usd), 0) AS usd,
              COALESCE(SUM(CASE WHEN provider = 'firecrawl' THEN units ELSE 0 END), 0) AS firecrawlCredits,
              COALESCE(SUM(CASE WHEN provider = 'browser_use' THEN usd ELSE 0 END), 0) AS browserUseUsd,
              COALESCE(SUM(CASE WHEN provider = 'ai_gateway' THEN usd ELSE 0 END), 0) AS aiGatewayUsd,
              COALESCE(SUM(CASE WHEN provider = 'google_places' THEN usd ELSE 0 END), 0) AS googlePlacesUsd
       FROM cost_events
       WHERE created_at >= ?
       GROUP BY substr(created_at, 1, 10)
       ORDER BY date`,
    )
    .all(sinceIso) as {
    date: string;
    usd: number;
    firecrawlCredits: number;
    browserUseUsd: number;
    aiGatewayUsd: number;
    googlePlacesUsd: number;
  }[];

  const providerRows = db
    .prepare(
      `SELECT provider,
              unit_type,
              COALESCE(SUM(usd), 0) AS usd,
              COALESCE(SUM(units), 0) AS units,
              COUNT(*) AS count
       FROM cost_events
       WHERE created_at >= ?
       GROUP BY provider, unit_type
       ORDER BY usd DESC`,
    )
    .all(sinceIso) as {
    provider: string;
    unit_type: string;
    usd: number;
    units: number;
    count: number;
  }[];

  const mergedProviders = new Map<string, CostSeries["byProvider"][number]>();
  for (const row of providerRows) {
    const existing = mergedProviders.get(row.provider);
    if (existing) {
      existing.usd += row.usd;
      existing.units += row.units;
      existing.count += row.count;
    } else {
      mergedProviders.set(row.provider, {
        provider: row.provider,
        usd: row.usd,
        units: row.units,
        unitType: row.unit_type,
        count: row.count,
      });
    }
  }
  const byProvider = [...mergedProviders.values()].sort((a, b) => b.usd - a.usd);

  const byOperation = db
    .prepare(
      `SELECT provider, operation, unit_type,
              COALESCE(SUM(usd), 0) AS usd,
              COUNT(*) AS count
       FROM cost_events
       WHERE created_at >= ?
       GROUP BY provider, operation, unit_type
       ORDER BY usd DESC
       LIMIT 20`,
    )
    .all(sinceIso) as {
    provider: string;
    operation: string;
    unit_type: string;
    usd: number;
    count: number;
  }[];

  return {
    byDay,
    byProvider,
    byOperation: byOperation.map((row) => ({
      provider: row.provider,
      operation: row.operation,
      usd: row.usd,
      count: row.count,
      unitType: row.unit_type,
    })),
    balances: getCreditBalances(),
  };
}

export function listFilterOptions(): { markets: string[]; categories: string[] } {
  if (!dbAvailable()) return { markets: [], categories: [] };
  const db = getDb();
  const markets = (
    db
      .prepare(
        "SELECT DISTINCT market_key FROM leads WHERE market_key IS NOT NULL ORDER BY market_key",
      )
      .all() as { market_key: string }[]
  ).map((r) => r.market_key);
  const categories = (
    db
      .prepare(
        "SELECT DISTINCT category_key FROM leads WHERE category_key IS NOT NULL ORDER BY category_key",
      )
      .all() as { category_key: string }[]
  ).map((r) => r.category_key);
  return { markets, categories };
}

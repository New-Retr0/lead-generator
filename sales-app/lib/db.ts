import { createClient } from "@/lib/supabase/server";
import type {
  CostSeries,
  CrmStatus,
  LeadDetail,
  LeadRow,
  LeadType,
  OverviewStats,
  RequestRow,
  RunEventRow,
  RunRow,
} from "./types";

function presentOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "Not found") return null;
  return trimmed;
}

function salesStatusFromView(row: Record<string, unknown>): string {
  const phone = presentOrNull(row.phone);
  const contacts = Array.isArray(row.contacts)
    ? (row.contacts as { phone?: string; email?: string }[])
    : [];
  const hasOutreach =
    Boolean(phone) ||
    contacts.some(
      (c) =>
        presentOrNull(c.phone) ||
        (typeof c.email === "string" && c.email.includes("@")),
    );
  if (row.enrichment_status === "enriched" && hasOutreach) return "Ready to call";
  if (hasOutreach) return "Ready to call";
  return "Needs research";
}

function mapSalesLeadRow(row: Record<string, unknown>): LeadRow {
  const categoryKey = (row.category_key as string | null) ?? null;
  const leadType: LeadType = categoryKey?.startsWith("vendor_") ? "vendor" : "client";
  return {
    place_id: String(row.place_id),
    business_name: String(row.business_name),
    market_key: (row.market_key as string | null) ?? null,
    category_key: categoryKey,
    city: (row.city as string | null) ?? null,
    last_enriched_at: (row.last_enriched_at as string | null) ?? null,
    enrichment_status: (row.enrichment_status as string | null) ?? null,
    confidence: (row.confidence as string | null) ?? null,
    verification_level: null,
    lead_score: (row.lead_score as number | null) ?? null,
    status: salesStatusFromView(row),
    crm_status: (row.crm_status as CrmStatus) ?? "New",
    lead_type: leadType,
    phone: (row.phone as string | null) ?? null,
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
  const supabase = await createClient();
  const limit = filters?.limit ?? 500;
  const { data, error } = await supabase
    .from("sales_leads")
    .select("*")
    .order("last_enriched_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  let leads = (data ?? []).map((row) => mapSalesLeadRow(row as Record<string, unknown>));
  if (filters?.market) leads = leads.filter((l) => l.market_key === filters.market);
  if (filters?.category) leads = leads.filter((l) => l.category_key === filters.category);
  if (filters?.crmStatus) leads = leads.filter((l) => l.crm_status === filters.crmStatus);
  if (filters?.type) leads = leads.filter((l) => l.lead_type === filters.type);
  if (filters?.minScore !== undefined)
    leads = leads.filter((l) => (l.lead_score ?? 0) >= filters.minScore!);
  return leads;
}

export async function getLeadDetail(placeId: string): Promise<LeadDetail | null> {
  const supabase = await createClient();
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("*")
    .eq("place_id", placeId)
    .maybeSingle();
  if (leadError) throw new Error(leadError.message);
  if (!lead) return null;

  const { data: sf } = await supabase
    .from("sales_feedback")
    .select("status, addressed, feedback_notes, updated_by_email")
    .eq("place_id", placeId)
    .maybeSingle();

  const data = (lead.enriched_json as Record<string, unknown>) ?? {};
  const rawContacts = Array.isArray(data.site_contacts)
    ? (data.site_contacts as Record<string, unknown>[])
    : [];
  const siteContacts = rawContacts.map((c) => ({
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
  const categoryKey = (lead.category_key as string | null) ?? null;
  const leadType: LeadType = categoryKey?.startsWith("vendor_") ? "vendor" : "client";

  return {
    place_id: placeId,
    business_name: String(data.business_name ?? lead.business_name ?? "Unknown"),
    market_key: (lead.market_key as string | null) ?? null,
    category_key: categoryKey,
    city: (lead.city as string | null) ?? null,
    last_enriched_at: (lead.last_enriched_at as string | null) ?? null,
    enrichment_status: (lead.enrichment_status as string | null) ?? null,
    confidence: (lead.confidence as string | null) ?? null,
    verification_level:
      typeof data.verification_level === "string" ? data.verification_level : null,
    lead_score: (lead.lead_score as number | null) ?? null,
    status: salesStatusFromView({
      phone: data.main_phone ?? data.best_contact_phone,
      contacts: data.site_contacts,
      enrichment_status: lead.enrichment_status,
    }),
    crm_status: (sf?.status as CrmStatus) ?? "New",
    lead_type: leadType,
    phone:
      presentOrNull(data.main_phone) ??
      presentOrNull(data.best_contact_phone) ??
      null,
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
    talking_points: presentOrNull(data.sales_talking_points),
    need_signals: presentOrNull(data.exterior_cleaning_need_signals),
    site_contacts: siteContacts,
    facts: [],
    evidence_urls: Array.isArray(data.evidence_urls)
      ? (data.evidence_urls as string[])
      : [],
    notes: presentOrNull(data.notes),
    related: [],
    source_checks: [],
    costs: {
      totalUsd: 0,
      verifiedUsd: 0,
      estimatedUsd: 0,
      firecrawlCreditsEst: 0,
      eventCount: 0,
      byProvider: [],
      events: [],
    },
  };
}

export async function listFilterOptions(): Promise<{ markets: string[]; categories: string[] }> {
  const supabase = await createClient();
  const { data } = await supabase.from("leads").select("market_key, category_key");
  const markets = [
    ...new Set((data ?? []).map((r) => r.market_key).filter(Boolean) as string[]),
  ].sort();
  const categories = [
    ...new Set((data ?? []).map((r) => r.category_key).filter(Boolean) as string[]),
  ].sort();
  return { markets, categories };
}

export async function getOverview(): Promise<OverviewStats> {
  const supabase = await createClient();
  const { count: totalLeads } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true });
  const { count: enrichedLeads } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .not("enriched_json", "is", null);

  return {
    totalLeads: totalLeads ?? 0,
    enrichedLeads: enrichedLeads ?? 0,
    readyToCall: 0,
    readyToCallRate: 0,
    creditsThisMonth: 0,
    browserUseUsdThisMonth: 0,
    aiGatewayUsdThisMonth: 0,
    usdByProvider: [],
    balances: [],
  };
}

export async function listRuns(limit = 50): Promise<RunRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as RunRow[];
}

export async function getRunEvents(runId: string): Promise<RunEventRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("run_events")
    .select("id, run_id, place_id, stage, ran, reason, credits_est, created_at")
    .eq("run_id", runId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    ...r,
    ran: r.ran ? 1 : 0,
  })) as RunEventRow[];
}

export async function getRunDetail(runId: string) {
  const supabase = await createClient();
  const { data: run } = await supabase.from("runs").select("*").eq("run_id", runId).maybeSingle();
  if (!run) return null;
  return {
    run: run as RunRow,
    costs: {
      totalUsd: 0,
      verifiedUsd: 0,
      estimatedUsd: 0,
      firecrawlCreditsEst: 0,
      eventCount: 0,
      leadCount: 0,
      byProvider: [],
    },
    timeline: { runEvents: [], leads: [] },
  };
}

export async function listRequests(limit = 50): Promise<RequestRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    request_id: row.request_id,
    created_at: row.created_at,
    raw_prompt: row.raw_prompt,
    status: row.status,
    leads_delivered: row.leads_delivered,
    credits_spent: row.credits_spent,
    usd_spent: row.usd_spent,
    spec: (row.spec_json as Record<string, unknown>) ?? {},
  }));
}

export async function getCostSeries(days = 30): Promise<CostSeries> {
  const supabase = await createClient();
  const since = new Date();
  since.setDate(since.getDate() - days);
  const { data: byDay } = await supabase
    .from("cost_by_day")
    .select("*")
    .gte("date", since.toISOString().slice(0, 10));
  const { data: byProvider } = await supabase.from("cost_by_provider").select("*");
  return {
    byDay: (byDay ?? []).map((r) => ({
      date: r.date,
      usd: Number(r.usd),
      firecrawlCredits: Number(r.firecrawl_credits),
      browserUseUsd: Number(r.browser_use_usd),
      aiGatewayUsd: Number(r.ai_gateway_usd),
      googlePlacesUsd: Number(r.google_places_usd),
    })),
    byProvider: (byProvider ?? []).map((r) => ({
      provider: r.provider,
      usd: Number(r.usd),
      units: Number(r.units),
      unitType: r.unit_type,
      count: Number(r.event_count),
    })),
    byOperation: [],
    balances: [],
  };
}

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const API_VERSION = "v1";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const MIN_EXPORT_SCORE = 25;
const LEAD_ACTIONS = new Set(["outcome", "touches", "eligibility"]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-api-key, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const OUTCOMES = ["won", "lost", "bad_data", "unqualified", "no_response"] as const;
const OUTCOME_REASONS = [
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
const TOUCH_TYPES = ["call", "email", "sms", "visit", "other"] as const;
const TOUCH_RESULTS = [
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

const OUTCOME_TO_CRM: Record<string, string> = {
  won: "Won",
  lost: "Lost",
  bad_data: "Bad Data",
  unqualified: "Lost",
  no_response: "Lost",
};

type PartnerKey = {
  id: string;
  key_hash: string;
  partner_name: string;
  scopes: string[];
  rate_limit_per_minute: number;
  daily_row_limit: number;
};

type PartnerLeadRow = {
  lead_id: string;
  place_id: string;
  lead_type: "client" | "vendor";
  business_name: string;
  category_key: string | null;
  market_key: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  website: string | null;
  google_maps_url: string | null;
  primary_phone: string | null;
  best_contact_name: string | null;
  best_contact_role: string | null;
  best_contact_type: string | null;
  best_contact_email_or_form: string | null;
  lead_score: number | null;
  confidence: string | null;
  verification_level: string | null;
  status?: string | null;
  why_now: string | null;
  last_enriched_at: string | null;
  last_worked_at?: string | null;
  updated_at: string;
  site_contacts: unknown;
  evidence_urls: unknown;
  enriched_facts: unknown;
  score_breakdown: unknown;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  {
    auth: { persistSession: false },
  },
);

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      ...extraHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
    },
  });
}

function error(code: string, message: string, status: number, retryAfter?: number) {
  const headers = retryAfter ? { "Retry-After": String(retryAfter) } : {};
  return json({ error: { code, message } }, status, headers);
}

function extractApiKey(req: Request): string | null {
  // Prefer x-api-key; Bearer remains supported for compatibility.
  const xApiKey = req.headers.get("x-api-key")?.trim();
  if (xApiKey) return xApiKey;
  const auth = req.headers.get("authorization")?.trim();
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Parse /leads/{place_id}[/action] where place_id may contain slashes (e.g. places/ChIJ...). */
function parseLeadRoute(
  route: string[],
): { placeId: string; action?: string } | null {
  if (route[0] !== "leads" || route.length < 2) return null;
  const rest = route.slice(1);
  const last = rest[rest.length - 1]!;
  if (rest.length >= 2 && LEAD_ACTIONS.has(last)) {
    return {
      placeId: rest.slice(0, -1).map(decodePathSegment).join("/"),
      action: last,
    };
  }
  return { placeId: rest.map(decodePathSegment).join("/") };
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function authenticate(req: Request): Promise<PartnerKey | Response> {
  const apiKey = extractApiKey(req);
  if (!apiKey) return error("missing_api_key", "Provide a partner API key.", 401);

  const keyPrefix = apiKey.slice(0, 16);
  const keyHash = await sha256Hex(apiKey);
  const nowIso = new Date().toISOString();

  const { data, error: keyError } = await supabase
    .from("partner_api_keys")
    .select(
      "id, key_hash, partner_name, scopes, rate_limit_per_minute, daily_row_limit, expires_at",
    )
    .eq("key_prefix", keyPrefix)
    .eq("active", true)
    .maybeSingle();

  if (keyError) return error("auth_lookup_failed", keyError.message, 500);
  if (!data || !timingSafeEqual(String(data.key_hash), keyHash)) {
    return error("invalid_api_key", "The partner API key is invalid.", 401);
  }
  if (data.expires_at && String(data.expires_at) <= nowIso) {
    return error("expired_api_key", "The partner API key has expired.", 401);
  }

  return {
    id: String(data.id),
    key_hash: String(data.key_hash),
    partner_name: String(data.partner_name),
    scopes: Array.isArray(data.scopes) ? data.scopes.map(String) : [],
    rate_limit_per_minute: Number(data.rate_limit_per_minute ?? 60),
    daily_row_limit: Number(data.daily_row_limit ?? 10000),
  };
}

async function checkRateLimit(key: PartnerKey, requestedRows = 0): Promise<Response | null> {
  const minuteAgo = new Date(Date.now() - 60_000).toISOString();
  const { count, error: countError } = await supabase
    .from("partner_api_requests")
    .select("id", { count: "exact", head: true })
    .eq("key_id", key.id)
    .gte("created_at", minuteAgo);

  if (countError) return error("rate_limit_lookup_failed", countError.message, 500);
  if ((count ?? 0) >= key.rate_limit_per_minute) {
    return error("rate_limited", "Too many requests. Try again shortly.", 429, 60);
  }

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { data, error: rowsError } = await supabase
    .from("partner_api_requests")
    .select("row_count")
    .eq("key_id", key.id)
    .gte("created_at", dayStart.toISOString());

  if (rowsError) return error("daily_limit_lookup_failed", rowsError.message, 500);
  const rowsToday = (data ?? []).reduce((sum, row) => sum + Number(row.row_count ?? 0), 0);
  if (rowsToday + requestedRows > key.daily_row_limit) {
    return error("daily_row_limit_exceeded", "Daily lead row limit exceeded.", 429, 3600);
  }
  return null;
}

async function logRequest(
  req: Request,
  key: PartnerKey | null,
  endpoint: string,
  statusCode: number,
  rowCount: number,
  durationMs: number,
  errorCode?: string,
) {
  await supabase.from("partner_api_requests").insert({
    key_id: key?.id ?? null,
    endpoint,
    method: req.method,
    status_code: statusCode,
    row_count: rowCount,
    duration_ms: durationMs,
    error_code: errorCode ?? null,
    remote_addr:
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("cf-connecting-ip"),
    user_agent: req.headers.get("user-agent"),
  });
  if (key) {
    await supabase
      .from("partner_api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", key.id);
  }
}

function categoryLabel(categoryKey: string | null): string | null {
  if (!categoryKey) return null;
  return categoryKey
    .replace(/^vendor_/, "Vendor: ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function groupedFacts(value: unknown): Record<string, unknown[]> {
  const groups: Record<string, unknown[]> = {
    phone: [],
    person: [],
    email: [],
    social: [],
    insurance: [],
    other: [],
  };
  if (!Array.isArray(value)) return groups;
  for (const rawFact of value) {
    if (!rawFact || typeof rawFact !== "object") continue;
    const fact = rawFact as Record<string, unknown>;
    const kind = String(fact.fact_kind ?? "other").toLowerCase();
    const bucket =
      kind.includes("phone")
        ? "phone"
        : kind.includes("person") || kind.includes("owner")
          ? "person"
          : kind.includes("email")
            ? "email"
            : kind.includes("social")
              ? "social"
              : kind.includes("insurance")
                ? "insurance"
                : "other";
    groups[bucket].push({
      kind: fact.fact_kind,
      value: fact.value ?? fact.value_json ?? null,
      source_kind: fact.source_kind,
      source_url: fact.source_url,
      method: fact.method,
      verification: fact.verification,
      observed_at: fact.observed_at,
    });
  }
  return groups;
}

/** Null placeholder / non-dialable best_contact_phone sentinels (e.g. "Not found"). */
function partnerPrimaryPhone(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (
    lower === "not found" ||
    lower === "not specified" ||
    lower === "unknown" ||
    lower === "n/a" ||
    lower === "na" ||
    lower === "none" ||
    lower === "unavailable" ||
    lower === "tbd" ||
    lower === "see website"
  ) {
    return null;
  }
  return raw;
}

function toListLead(row: PartnerLeadRow) {
  return {
    lead_id: row.lead_id,
    place_id: row.place_id,
    lead_type: row.lead_type,
    business_name: row.business_name,
    category_key: row.category_key,
    category_label: categoryLabel(row.category_key),
    market_key: row.market_key,
    city: row.city,
    state: row.state,
    address: row.address,
    website: row.website,
    google_maps_url: row.google_maps_url,
    primary_phone: partnerPrimaryPhone(row.primary_phone),
    best_contact: {
      name: row.best_contact_name,
      role: row.best_contact_role,
      type: row.best_contact_type,
      email_or_form: row.best_contact_email_or_form,
    },
    lead_score: row.lead_score,
    confidence: row.confidence,
    status: "verified",
    verification_level: row.verification_level,
    why_now: row.why_now,
    last_worked_at: row.last_worked_at ?? row.last_enriched_at,
    updated_at: row.updated_at,
  };
}

function toDetailLead(row: PartnerLeadRow) {
  return {
    ...toListLead(row),
    site_contacts: Array.isArray(row.site_contacts) ? row.site_contacts : [],
    evidence_urls: Array.isArray(row.evidence_urls) ? row.evidence_urls : [],
    fact_summaries: groupedFacts(row.enriched_facts),
    score_breakdown:
      row.score_breakdown && typeof row.score_breakdown === "object"
        ? row.score_breakdown
        : {},
    coordinates: {
      latitude: row.latitude,
      longitude: row.longitude,
    },
    notes: row.notes,
  };
}

function encodeCursor(row: PartnerLeadRow): string {
  const payload = JSON.stringify({ updated_at: row.updated_at, place_id: row.place_id });
  return btoa(payload).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeCursor(cursor: string): { updated_at: string; place_id: string } | null {
  try {
    const padded = cursor.replace(/-/g, "+").replace(/_/g, "/").padEnd(
      Math.ceil(cursor.length / 4) * 4,
      "=",
    );
    const parsed = JSON.parse(atob(padded)) as Record<string, unknown>;
    if (typeof parsed.updated_at !== "string" || typeof parsed.place_id !== "string") {
      return null;
    }
    return { updated_at: parsed.updated_at, place_id: parsed.place_id };
  } catch {
    return null;
  }
}

async function handleMetadata() {
  const { data, error: queryError } = await supabase
    .from("verified_leads_v1")
    .select("lead_type, category_key, market_key");
  if (queryError) return error("metadata_query_failed", queryError.message, 500);

  const categories = new Map<string, { key: string; label: string | null }>();
  const markets = new Set<string>();
  for (const row of data ?? []) {
    if (row.category_key) {
      categories.set(String(row.category_key), {
        key: String(row.category_key),
        label: categoryLabel(String(row.category_key)),
      });
    }
    if (row.market_key) markets.add(String(row.market_key));
  }

  return json({
    api_version: API_VERSION,
    schema_version: "verified-leads-v1",
    lead_types: ["client", "vendor", "all"],
    max_limit: MAX_LIMIT,
    cursor: {
      sort: ["updated_at", "place_id"],
      mode: "forward-only",
    },
    categories: [...categories.values()].sort((a, b) => a.key.localeCompare(b.key)),
    markets: [...markets].sort(),
  });
}

async function handleList(url: URL, key: PartnerKey) {
  const limitParam = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : DEFAULT_LIMIT, 1), MAX_LIMIT);
  const type = url.searchParams.get("type") ?? "client";
  const cursorParam = url.searchParams.get("cursor");
  const updatedSince = url.searchParams.get("updated_since");
  const cursor = cursorParam ? decodeCursor(cursorParam) : null;

  if (!["client", "vendor", "all"].includes(type)) {
    return error("invalid_type", "type must be client, vendor, or all.", 400);
  }
  if (cursorParam && !cursor) return error("invalid_cursor", "Cursor is malformed.", 400);

  const limited = await checkRateLimit(key, limit);
  if (limited) return limited;

  let query = supabase
    .from("verified_leads_v1")
    .select("*")
    .order("updated_at", { ascending: true })
    .order("place_id", { ascending: true })
    .limit(limit + 1);

  if (type !== "all") query = query.eq("lead_type", type);
  if (cursor) {
    query = query.or(
      `updated_at.gt.${cursor.updated_at},and(updated_at.eq.${cursor.updated_at},place_id.gt.${cursor.place_id})`,
    );
  } else if (updatedSince) {
    query = query.gte("updated_at", updatedSince);
  }

  const { data, error: queryError } = await query;
  if (queryError) return error("leads_query_failed", queryError.message, 500);

  const rows = (data ?? []) as PartnerLeadRow[];
  const pageRows = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const nextCursor = hasMore && pageRows.length > 0 ? encodeCursor(pageRows[pageRows.length - 1]) : null;

  return json({
    data: pageRows.map(toListLead),
    page: {
      limit,
      next_cursor: nextCursor,
      has_more: hasMore,
    },
    meta: {
      api_version: API_VERSION,
      generated_at: new Date().toISOString(),
      filters: { type, updated_since: updatedSince },
    },
  });
}

async function handleDetail(placeId: string, key: PartnerKey) {
  const limited = await checkRateLimit(key, 1);
  if (limited) return limited;

  const { data, error: queryError } = await supabase
    .from("verified_leads_v1")
    .select("*")
    .eq("place_id", placeId)
    .maybeSingle();

  if (queryError) return error("lead_query_failed", queryError.message, 500);
  if (!data) return error("not_found", "Lead not found or not verified.", 404);

  return json({
    data: toDetailLead(data as PartnerLeadRow),
    meta: {
      api_version: API_VERSION,
      generated_at: new Date().toISOString(),
    },
  });
}

async function leadExists(placeId: string): Promise<boolean> {
  const { data, error: queryError } = await supabase
    .from("leads")
    .select("place_id")
    .eq("place_id", placeId)
    .maybeSingle();
  if (queryError) throw new Error(queryError.message);
  return Boolean(data);
}

async function handleUsage(key: PartnerKey) {
  const limited = await checkRateLimit(key, 0);
  if (limited) return limited;

  const minuteAgo = new Date(Date.now() - 60_000).toISOString();
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayIso = dayStart.toISOString();

  const [minuteCount, dayRows] = await Promise.all([
    supabase
      .from("partner_api_requests")
      .select("id", { count: "exact", head: true })
      .eq("key_id", key.id)
      .gte("created_at", minuteAgo),
    supabase
      .from("partner_api_requests")
      .select("row_count")
      .eq("key_id", key.id)
      .gte("created_at", dayIso),
  ]);

  if (minuteCount.error) return error("usage_lookup_failed", minuteCount.error.message, 500);
  if (dayRows.error) return error("usage_lookup_failed", dayRows.error.message, 500);

  const requestsLastMinute = minuteCount.count ?? 0;
  const rowsToday = (dayRows.data ?? []).reduce(
    (sum, row) => sum + Number(row.row_count ?? 0),
    0,
  );

  return json({
    data: {
      partner_name: key.partner_name,
      scopes: key.scopes,
      rate_limit_per_minute: key.rate_limit_per_minute,
      requests_last_minute: requestsLastMinute,
      requests_remaining_minute: Math.max(key.rate_limit_per_minute - requestsLastMinute, 0),
      daily_row_limit: key.daily_row_limit,
      rows_today: rowsToday,
      rows_remaining_today: Math.max(key.daily_row_limit - rowsToday, 0),
    },
    meta: {
      api_version: API_VERSION,
      generated_at: new Date().toISOString(),
    },
  });
}

async function handleEligibility(placeId: string, key: PartnerKey) {
  const limited = await checkRateLimit(key, 1);
  if (limited) return limited;

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("place_id, enrichment_status, confidence, lead_score, enriched_json")
    .eq("place_id", placeId)
    .maybeSingle();
  if (leadError) return error("eligibility_query_failed", leadError.message, 500);
  if (!lead) return error("not_found", "Lead not found.", 404);

  const enrichedJson = lead.enriched_json;
  const verificationLevel =
    enrichedJson && typeof enrichedJson === "object"
      ? String((enrichedJson as Record<string, unknown>).verification_level ?? "")
      : "";

  const { data: verifiedDm, error: dmError } = await supabase.rpc(
    "is_verified_decision_maker",
    {
      enriched: enrichedJson ?? {},
      verification_level: verificationLevel || null,
    },
  );
  if (dmError) return error("eligibility_query_failed", dmError.message, 500);

  const { data: partnerRow, error: partnerError } = await supabase
    .from("verified_leads_v1")
    .select("place_id")
    .eq("place_id", placeId)
    .maybeSingle();
  if (partnerError) return error("eligibility_query_failed", partnerError.message, 500);

  const gates = {
    has_lead_payload:
      lead.enrichment_status === "enriched" &&
      lead.enriched_json != null &&
      typeof lead.enriched_json === "object",
    confidence_ok: String(lead.confidence ?? "") !== "Low",
    score_ok: Number(lead.lead_score ?? 0) >= MIN_EXPORT_SCORE,
    verified_decision_maker: Boolean(verifiedDm),
  };
  const failures = Object.entries(gates)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  return json({
    data: {
      place_id: placeId,
      eligible: Boolean(partnerRow),
      is_verified: Boolean(partnerRow),
      status: partnerRow ? "verified" : "unverified",
      gates,
      failures,
      notes: [
        "Eligible leads are Verified only: named decision-maker + grounded local phone (not Google mainline alone).",
        `Score gate uses lead_score >= ${MIN_EXPORT_SCORE}.`,
      ],
    },
    meta: {
      api_version: API_VERSION,
      generated_at: new Date().toISOString(),
    },
  });
}

async function lookupIdempotency(
  key: PartnerKey,
  idempotencyKey: string,
  route: string,
): Promise<Response | null> {
  const { data, error: queryError } = await supabase
    .from("partner_idempotency_keys")
    .select("response_json")
    .eq("partner_key_id", key.id)
    .eq("idempotency_key", idempotencyKey)
    .eq("route", route)
    .maybeSingle();
  if (queryError || !data?.response_json) return null;
  return json(data.response_json as Record<string, unknown>);
}

async function storeIdempotency(
  key: PartnerKey,
  idempotencyKey: string,
  route: string,
  response: Response,
): Promise<void> {
  if (!response.ok) return;
  const body = await response.clone().json().catch(() => null);
  if (!body || typeof body !== "object") return;
  await supabase.from("partner_idempotency_keys").upsert(
    {
      partner_key_id: key.id,
      idempotency_key: idempotencyKey,
      route,
      response_json: body,
    },
    { onConflict: "partner_key_id,idempotency_key,route" },
  );
}

async function withIdempotency(
  req: Request,
  key: PartnerKey,
  route: string,
  handler: () => Promise<Response>,
): Promise<Response> {
  const idempotencyKey = req.headers.get("idempotency-key")?.trim() ?? "";
  if (!idempotencyKey) return handler();
  const cached = await lookupIdempotency(key, idempotencyKey, route);
  if (cached) return cached;
  const response = await handler();
  await storeIdempotency(key, idempotencyKey, route, response).catch((err) =>
    console.error("partner-api idempotency store failed", err)
  );
  return response;
}

async function mirrorSalesFeedback(placeId: string, outcome: string, notes?: string | null) {
  const status = OUTCOME_TO_CRM[outcome] ?? "Lost";
  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from("sales_feedback")
    .select("addressed, feedback_notes, sales_ready, assigned_to")
    .eq("place_id", placeId)
    .maybeSingle();
  await supabase.from("sales_feedback").upsert({
    place_id: placeId,
    status,
    feedback_notes: notes ?? existing?.feedback_notes ?? "",
    addressed: existing?.addressed ?? false,
    sales_ready: existing?.sales_ready ?? null,
    assigned_to: existing?.assigned_to ?? null,
    updated_at: now,
  });
}

async function handlePostOutcome(placeId: string, key: PartnerKey, body: Record<string, unknown>) {
  const limited = await checkRateLimit(key, 1);
  if (limited) return limited;
  if (!(await leadExists(placeId))) {
    return error("not_found", "Lead not found.", 404);
  }
  const outcome = String(body.outcome ?? "");
  if (!OUTCOMES.includes(outcome as (typeof OUTCOMES)[number])) {
    return error("invalid_outcome", "outcome must be a supported value.", 400);
  }
  const reason = body.outcome_reason != null ? String(body.outcome_reason) : null;
  if (reason && !OUTCOME_REASONS.includes(reason as (typeof OUTCOME_REASONS)[number])) {
    return error("invalid_outcome_reason", "outcome_reason is not allowed.", 400);
  }
  const quality = body.quality_rating != null ? Number(body.quality_rating) : null;
  if (quality != null && (quality < 1 || quality > 5)) {
    return error("invalid_quality_rating", "quality_rating must be 1-5.", 400);
  }
  const now = new Date().toISOString();
  const decidedAt = typeof body.decided_at === "string" ? body.decided_at : now;
  // Partner-scoped row — does not overwrite other partners or CRM/auto outcomes.
  const row = {
    place_id: placeId,
    partner_key_id: key.id,
    outcome,
    outcome_reason: reason,
    deal_value_usd: body.deal_value_usd != null ? Number(body.deal_value_usd) : null,
    quality_rating: quality,
    data_flags: body.data_flags && typeof body.data_flags === "object" ? body.data_flags : {},
    notes: body.notes != null ? String(body.notes) : null,
    decided_at: decidedAt,
    updated_at: now,
  };
  const { data, error: upsertError } = await supabase
    .from("partner_lead_outcomes")
    .upsert(row, { onConflict: "place_id,partner_key_id" })
    .select("*")
    .single();
  if (upsertError) return error("outcome_write_failed", upsertError.message, 500);

  // Mirror into lead_outcomes for dashboard/operator feedback when empty or auto-only.
  // Never clobber an operator CRM/dashboard row.
  const { data: existingOutcome } = await supabase
    .from("lead_outcomes")
    .select("source")
    .eq("place_id", placeId)
    .maybeSingle();
  if (!existingOutcome || existingOutcome.source === "auto") {
    await supabase.from("lead_outcomes").upsert(
      {
        place_id: placeId,
        outcome,
        outcome_reason: reason,
        deal_value_usd: row.deal_value_usd,
        quality_rating: quality,
        data_flags: row.data_flags,
        source: "partner_api",
        partner_key_id: key.id,
        notes: row.notes,
        decided_at: decidedAt,
        updated_at: now,
      },
      { onConflict: "place_id" },
    );
  }

  await mirrorSalesFeedback(placeId, outcome, row.notes);
  return json({
    data: { ...data, source: "partner_api", partner_key_id: key.id },
    meta: { api_version: API_VERSION, generated_at: now },
  });
}

async function handleGetOutcome(placeId: string, key: PartnerKey) {
  const limited = await checkRateLimit(key, 1);
  if (limited) return limited;
  const { data, error: queryError } = await supabase
    .from("partner_lead_outcomes")
    .select("*")
    .eq("place_id", placeId)
    .eq("partner_key_id", key.id)
    .maybeSingle();
  if (queryError) return error("outcome_query_failed", queryError.message, 500);
  if (!data) return error("not_found", "No outcome recorded for this lead by this API key.", 404);
  return json({
    data: { ...data, source: "partner_api" },
    meta: { api_version: API_VERSION, generated_at: new Date().toISOString() },
  });
}

async function handlePostTouch(placeId: string, key: PartnerKey, body: Record<string, unknown>) {
  const limited = await checkRateLimit(key, 1);
  if (limited) return limited;
  if (!(await leadExists(placeId))) {
    return error("not_found", "Lead not found.", 404);
  }
  const touchType = String(body.touch_type ?? "");
  if (!TOUCH_TYPES.includes(touchType as (typeof TOUCH_TYPES)[number])) {
    return error("invalid_touch_type", "touch_type is required and must be valid.", 400);
  }
  const result = body.result != null ? String(body.result) : null;
  if (result && !TOUCH_RESULTS.includes(result as (typeof TOUCH_RESULTS)[number])) {
    return error("invalid_touch_result", "result is not allowed.", 400);
  }
  const row = {
    place_id: placeId,
    touch_type: touchType,
    result,
    contact_name: body.contact_name != null ? String(body.contact_name) : null,
    contact_phone: body.contact_phone != null ? String(body.contact_phone) : null,
    duration_seconds: body.duration_seconds != null ? Number(body.duration_seconds) : null,
    source: "partner_api",
    partner_key_id: key.id,
    notes: body.notes != null ? String(body.notes) : null,
    meta_json: body.meta && typeof body.meta === "object" ? body.meta : null,
    occurred_at: typeof body.occurred_at === "string" ? body.occurred_at : new Date().toISOString(),
  };
  const { data, error: insertError } = await supabase
    .from("lead_touches")
    .insert(row)
    .select("*")
    .single();
  if (insertError) return error("touch_write_failed", insertError.message, 500);
  return json({ data, meta: { api_version: API_VERSION, generated_at: new Date().toISOString() } });
}

async function handleGetTouches(placeId: string, key: PartnerKey, url: URL) {
  const limitParam = Number(url.searchParams.get("limit") ?? 50);
  const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 50, 1), 200);
  const limited = await checkRateLimit(key, limit);
  if (limited) return limited;
  const { data, error: queryError } = await supabase
    .from("lead_touches")
    .select("*")
    .eq("place_id", placeId)
    .eq("partner_key_id", key.id)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (queryError) return error("touches_query_failed", queryError.message, 500);
  return json({
    data: data ?? [],
    page: { limit, count: (data ?? []).length },
    meta: { api_version: API_VERSION, generated_at: new Date().toISOString() },
  });
}

async function handleFeedbackBatch(key: PartnerKey, body: unknown) {
  if (!Array.isArray(body)) {
    return error("invalid_body", "Batch body must be a JSON array.", 400);
  }
  if (body.length > 100) {
    return error("batch_too_large", "Maximum 100 items per batch.", 400);
  }
  const limited = await checkRateLimit(key, body.length);
  if (limited) return limited;
  const results: unknown[] = [];
  for (const item of body) {
    if (!item || typeof item !== "object") {
      results.push({ ok: false, error: "invalid_item" });
      continue;
    }
    const record = item as Record<string, unknown>;
    const placeId = String(record.place_id ?? "");
    if (!placeId) {
      results.push({ ok: false, error: "missing_place_id" });
      continue;
    }
    if (record.outcome) {
      const resp = await handlePostOutcome(placeId, key, record);
      const payload = await resp.json();
      results.push({ ok: resp.ok, place_id: placeId, kind: "outcome", ...payload });
    } else if (record.touch_type) {
      const resp = await handlePostTouch(placeId, key, record);
      const payload = await resp.json();
      results.push({ ok: resp.ok, place_id: placeId, kind: "touch", ...payload });
    } else {
      results.push({ ok: false, place_id: placeId, error: "missing_outcome_or_touch" });
    }
  }
  return json({ data: results, meta: { api_version: API_VERSION, count: results.length } });
}

Deno.serve(async (req: Request) => {
  const started = Date.now();
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const versionIndex = parts.lastIndexOf(API_VERSION);
  const route = versionIndex >= 0 ? parts.slice(versionIndex + 1) : parts.slice(1);
  const endpoint = `/${API_VERSION}/${route.join("/")}`;

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (route[0] === "health") {
    return json({
      ok: true,
      api_version: API_VERSION,
      generated_at: new Date().toISOString(),
    });
  }

  let key: PartnerKey | null = null;
  let response: Response;
  let rowCount = 0;
  let errorCode: string | undefined;

  const authResult = await authenticate(req);
  if (authResult instanceof Response) {
    response = authResult;
    errorCode = "auth_failed";
  } else {
    key = authResult;
    const leadRoute = parseLeadRoute(route);
    const isUsageRead = req.method === "GET" && route[0] === "usage" && route.length === 1;
    const isLeadRead =
      req.method === "GET" &&
      (route[0] === "metadata" ||
        isUsageRead ||
        (route[0] === "leads" && route.length === 1) ||
        (leadRoute != null && !leadRoute.action) ||
        (leadRoute?.action === "eligibility"));
    const isFeedbackRead =
      req.method === "GET" &&
      leadRoute != null &&
      (leadRoute.action === "outcome" || leadRoute.action === "touches");
    const isFeedbackWrite =
      req.method === "POST" &&
      ((leadRoute != null &&
        (leadRoute.action === "outcome" || leadRoute.action === "touches")) ||
        (route[0] === "feedback" && route[1] === "batch"));

    if (isLeadRead && !key.scopes.includes("leads:read")) {
      response = error("missing_scope", "This key cannot read leads.", 403);
      errorCode = "missing_scope";
    } else if ((isFeedbackRead || isFeedbackWrite) && !key.scopes.includes("leads:feedback")) {
      response = error("missing_scope", "This key cannot post or read feedback.", 403);
      errorCode = "missing_scope";
    } else if (req.method === "GET" && route[0] === "metadata") {
      response = await handleMetadata();
    } else if (isUsageRead) {
      response = await handleUsage(key);
    } else if (req.method === "GET" && route[0] === "leads" && route.length === 1) {
      response = await handleList(url, key);
    } else if (req.method === "GET" && leadRoute && leadRoute.action === "eligibility") {
      response = await handleEligibility(leadRoute.placeId, key);
    } else if (req.method === "GET" && leadRoute && !leadRoute.action) {
      response = await handleDetail(leadRoute.placeId, key);
    } else if (req.method === "GET" && leadRoute?.action === "outcome") {
      response = await handleGetOutcome(leadRoute.placeId, key);
    } else if (req.method === "GET" && leadRoute?.action === "touches") {
      response = await handleGetTouches(leadRoute.placeId, key, url);
    } else if (req.method === "POST" && leadRoute?.action === "outcome") {
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body) {
        response = error("invalid_body", "JSON body required.", 400);
      } else {
        response = await withIdempotency(
          req,
          key,
          `POST /leads/${leadRoute.placeId}/outcome`,
          () => handlePostOutcome(leadRoute.placeId, key, body),
        );
      }
    } else if (req.method === "POST" && leadRoute?.action === "touches") {
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body) {
        response = error("invalid_body", "JSON body required.", 400);
      } else {
        response = await withIdempotency(
          req,
          key,
          `POST /leads/${leadRoute.placeId}/touches`,
          () => handlePostTouch(leadRoute.placeId, key, body),
        );
      }
    } else if (req.method === "POST" && route[0] === "feedback" && route[1] === "batch") {
      const body = await req.json().catch(() => null);
      response = await withIdempotency(req, key, "POST /feedback/batch", () =>
        handleFeedbackBatch(key, body),
      );
    } else {
      response = error("not_found", "Unknown partner API endpoint.", 404);
      errorCode = "not_found";
    }
  }

  try {
    const cloned = response.clone();
    const body = await cloned.json().catch(() => null) as { data?: unknown; error?: { code?: string } } | null;
    if (Array.isArray(body?.data)) rowCount = body.data.length;
    else if (body?.data) rowCount = 1;
    if (!errorCode && body?.error?.code) errorCode = body.error.code;
  } catch {
    // best-effort logging only
  }

  await logRequest(req, key, endpoint, response.status, rowCount, Date.now() - started, errorCode)
    .catch((logError) => console.error("partner-api audit log failed", logError));

  return response;
});

import type { CrmStatus, LeadType } from "./types";

export type EnrichedJson = {
  investigation_status?: string;
  verification_level?: string;
  main_phone?: string | null;
  site_contacts?: { phone?: string; email?: string }[];
  best_contact_phone?: string;
  best_contact_email_or_form?: string;
  facts?: unknown[];
  business_name?: string;
  address?: string;
  city?: string;
  state?: string;
  website?: string;
  google_maps_url?: string;
  best_contact_name?: string;
  best_contact_role?: string;
  property_manager_or_ownership_clue?: string;
  why_this_is_a_good_fit?: string;
  why_now?: string;
  score_breakdown?: Record<string, number>;
  sales_talking_points?: string;
  exterior_cleaning_need_signals?: string;
  evidence_urls?: string[];
  notes?: string;
};

export function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return String(value);
}

export function toIsoOrNull(value: unknown): string | null {
  if (value == null) return null;
  return toIso(value);
}

export function parseEnrichedJson(raw: unknown): EnrichedJson {
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

export function isReadyToCall(data: EnrichedJson): boolean {
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

export function salesStatus(data: EnrichedJson): string {
  return isReadyToCall(data) ? "Ready to call" : "Needs research";
}

export function primaryPhone(data: EnrichedJson): string | null {
  if (data.main_phone && data.main_phone !== "Not found") return data.main_phone;
  for (const c of data.site_contacts ?? []) {
    if (c.phone && c.phone !== "Not found") return c.phone;
  }
  if (data.best_contact_phone && data.best_contact_phone !== "Not found") {
    return data.best_contact_phone;
  }
  return null;
}

export const NOT_FOUND = "Not found";

export function presentOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === NOT_FOUND) return null;
  return trimmed;
}

export function normalizeListText(value: string | null): string | null {
  if (!value) return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return value;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String).join("\n");
  } catch {
    // fall through
  }
  const parts = trimmed
    .slice(1, -1)
    .split(/['"],\s*['"]/)
    .map((p) => p.replace(/^\s*['"]+|['"]+\s*$/g, "").trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : value;
}

export function leadTypeFromCategory(categoryKey: string | null): LeadType {
  return categoryKey?.startsWith("vendor_") ? "vendor" : "client";
}

export function crmStatusFromFeedback(
  feedback: { status?: string } | { status?: string }[] | null | undefined,
): CrmStatus {
  const row = Array.isArray(feedback) ? feedback[0] : feedback;
  const status = row?.status;
  if (typeof status === "string") return status as CrmStatus;
  return "New";
}

export function addressedFromFeedback(
  feedback: { addressed?: boolean } | { addressed?: boolean }[] | null | undefined,
): boolean {
  const row = Array.isArray(feedback) ? feedback[0] : feedback;
  return Boolean(row?.addressed);
}

import {
  DECISION_ROLES,
  FACILITIES_ROLE_PATTERN,
  JUNK_ROLE_PATTERN,
} from "@/lib/generated/decision-roles";

const PLACEHOLDER_NAMES = new Set([
  "",
  "john doe",
  "jane doe",
  "john smith",
  "jane smith",
  "joe bloggs",
  "test test",
  "first last",
  "firstname lastname",
  "your name",
  "full name",
  "lorem ipsum",
  "n/a",
  "na",
  "none",
  "unknown",
  "example",
  "contact name",
  "sample name",
  "not found",
]);

const PLACEHOLDER_PHONE_TEXT = [
  "not specified",
  "not found",
  "unknown",
  "n/a",
  "none",
  "unavailable",
  "tbd",
  "see website",
] as const;

const TOLL_FREE_PREFIXES = new Set(["800", "888", "877", "866", "855", "844", "833", "822"]);

const FACILITIES_RE = new RegExp(`\\b(${FACILITIES_ROLE_PATTERN})\\b`, "i");
const JUNK_RE = new RegExp(`\\b(${JUNK_ROLE_PATTERN})\\b`, "i");

export type ReadinessContact = {
  label?: string | null;
  role?: string | null;
  name?: string | null;
  phone?: string | null;
};

export type LeadReadinessInput = {
  verification_level?: string | null;
  best_contact_name?: string | null;
  best_contact_role?: string | null;
  best_contact_phone?: string | null;
  site_contacts?: ReadinessContact[] | null;
};

function normalizedPhoneDigits(value: string | null | undefined): string {
  const raw = value?.trim() ?? "";
  const digits = raw.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

export function isLocalCallablePhone(value: string | null | undefined): boolean {
  const raw = value?.trim().toLowerCase() ?? "";
  if (!raw || PLACEHOLDER_PHONE_TEXT.some((text) => raw.includes(text))) return false;
  const digits = normalizedPhoneDigits(value);
  if (digits.length !== 10) return false;
  const area = digits.slice(0, 3);
  const exchange = digits.slice(3, 6);
  if (TOLL_FREE_PREFIXES.has(area)) return false;
  if (["000", "111", "555"].includes(area) || ["000", "555"].includes(exchange)) return false;
  if (["1234567890", "0123456789", "0000000000"].includes(digits)) return false;
  return new Set(digits).size > 1;
}

function isNamedPerson(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
  if (!normalized || PLACEHOLDER_NAMES.has(normalized)) return false;
  // Verified contract: first + last (at least two tokens).
  return normalized.split(" ").length >= 2;
}

function isJunkRole(value: string): boolean {
  const normalized = value.toLowerCase();
  if (FACILITIES_RE.test(normalized)) return false;
  return JUNK_RE.test(normalized);
}

function isDecisionMakerRole(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  return Boolean(
    normalized &&
      !isJunkRole(normalized) &&
      (normalized.includes("manager") ||
        DECISION_ROLES.some((role) => normalized.includes(role))),
  );
}

/** Local callable phone attached to a named decision-maker (ignores verification_level). */
export function primaryCallablePhone(data: LeadReadinessInput): string | null {
  if (
    isNamedPerson(data.best_contact_name) &&
    isDecisionMakerRole(data.best_contact_role) &&
    isLocalCallablePhone(data.best_contact_phone)
  ) {
    return data.best_contact_phone!.trim();
  }

  for (const contact of data.site_contacts ?? []) {
    const role = contact.label ?? contact.role;
    if (
      isNamedPerson(contact.name) &&
      isDecisionMakerRole(role) &&
      isLocalCallablePhone(contact.phone)
    ) {
      return contact.phone!.trim();
    }
  }
  return null;
}

export function isVerifiedDecisionMaker(data: LeadReadinessInput): boolean {
  if (data.verification_level !== "verified") return false;
  return primaryCallablePhone(data) != null;
}

export function leadReadinessStatus(data: LeadReadinessInput): "Verified" | "Unverified" {
  return isVerifiedDecisionMaker(data) ? "Verified" : "Unverified";
}

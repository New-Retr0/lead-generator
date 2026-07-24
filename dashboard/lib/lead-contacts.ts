import type { LeadDetail, LeadFact, SiteContact } from "./types";

export type VerificationLevel = "verified" | "corroborated" | "unverified" | "rejected";

export type ContactSource = {
  source_kind: string;
  source_url: string;
  method: string;
  label: string;
  quote: string;
};

export type PhoneGroup = {
  key: string;
  value: string;
  display: string;
  labels: string[];
  verification: VerificationLevel;
  isPrimary: boolean;
  sources: ContactSource[];
};

export type EmailGroup = {
  key: string;
  value: string;
  labels: string[];
  verification: VerificationLevel;
  sources: ContactSource[];
};

export type PersonGroup = {
  key: string;
  name: string;
  title: string;
  company: string;
  verification: VerificationLevel;
  sources: ContactSource[];
};

export type SocialGroup = {
  key: string;
  platform: string;
  url: string;
  verification: VerificationLevel;
  sources: ContactSource[];
};

export type RegistryInfo = {
  rating: string;
  accreditedSince: string;
  businessStarted: string;
  yearsInBusiness: string;
  entityType: string;
  alternateNames: string[];
  principals: PersonGroup[];
  sourceUrl: string;
};

export type GroupedLeadContacts = {
  phones: PhoneGroup[];
  emails: EmailGroup[];
  people: PersonGroup[];
  socials: SocialGroup[];
  registry: RegistryInfo | null;
};

const VERIFICATION_RANK: Record<VerificationLevel, number> = {
  verified: 3,
  corroborated: 2,
  unverified: 1,
  rejected: 0,
};

const PLACEHOLDER_NAMES = new Set([
  "",
  "not found",
  "not specified",
  "not listed",
  "n/a",
  "na",
  "none",
  "unknown",
  "john doe",
  "jane doe",
  "jane smith",
  "john smith",
]);

export function normalizePhoneKey(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

export function formatPhone(raw: string): string {
  const key = normalizePhoneKey(raw);
  if (key.length === 10) {
    return `(${key.slice(0, 3)}) ${key.slice(3, 6)}-${key.slice(6)}`;
  }
  return raw.trim();
}

export function cleanQuote(raw: string | null | undefined, maxLen = 220): string {
  if (!raw) return "";
  let text = raw.trim();
  text = text.replace(/!\[[^\]]*\]\([^)]+\)/g, "");
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/\*([^*]+)\*/g, "$1");
  text = text.replace(/\\([*_])/g, "$1");
  text = text.replace(/#{1,6}\s+/g, "");
  text = text.replace(/https?:\/\/\S+/g, "");
  text = text.replace(/\s+/g, " ").trim();
  if (text.length > maxLen) {
    return `${text.slice(0, maxLen).trim()}…`;
  }
  return text;
}

export function normalizeVerification(value: string | null | undefined): VerificationLevel {
  if (
    value === "verified" ||
    value === "corroborated" ||
    value === "unverified" ||
    value === "rejected"
  ) {
    return value;
  }
  return "unverified";
}

export function bestVerification(values: string[]): VerificationLevel {
  let best: VerificationLevel = "unverified";
  for (const value of values) {
    const normalized = normalizeVerification(value);
    if (VERIFICATION_RANK[normalized] > VERIFICATION_RANK[best]) {
      best = normalized;
    }
  }
  return best;
}

function sourceKey(source: ContactSource): string {
  return `${source.source_url}|${source.label}|${source.source_kind}`;
}

function addSource(sources: ContactSource[], source: ContactSource): void {
  const key = sourceKey(source);
  if (sources.some((s) => sourceKey(s) === key)) return;
  sources.push(source);
}

function factSource(fact: LeadFact, label: string): ContactSource {
  return {
    source_kind: fact.source_kind,
    source_url: fact.source_url,
    method: fact.method,
    label,
    quote: cleanQuote(fact.quote),
  };
}

function personKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function isNamedPerson(name: string | null | undefined): boolean {
  const normalized = personKey(name ?? "");
  // Partner contract: first + last (two tokens), not a placeholder or title-only.
  return Boolean(normalized) && normalized.split(" ").length >= 2 && !PLACEHOLDER_NAMES.has(normalized);
}

function socialPlatformKey(platform: string, url: string): string {
  const normalized = platform.trim().toLowerCase();
  if (normalized) return normalized;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.includes("facebook")) return "facebook";
    if (host.includes("instagram")) return "instagram";
    if (host.includes("linkedin")) return "linkedin";
    if (host.includes("youtube")) return "youtube";
    if (host.includes("twitter") || host.includes("x.com")) return "x";
  } catch {
    // fall through
  }
  return "social";
}

function isPrimaryPhoneLabel(label: string): boolean {
  const lower = label.toLowerCase();
  // Decision-maker phone is primary for ops — not Google Places mainline.
  return lower.includes("best contact");
}

function isMainlinePhoneLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return (
    lower.includes("listed phone") ||
    lower.includes("main line") ||
    lower.includes("google places")
  );
}

/** Map lead.verification_level onto contact-fact verification (no hard-coded Verified). */
function verificationFromLeadLevel(
  level: string | null | undefined,
): VerificationLevel {
  if (level === "verified") return "verified";
  if (level === "corroborated") return "corroborated";
  return "unverified";
}

function sourceKindFromUrl(url: string | null | undefined, fallback = "website"): string {
  const lower = (url ?? "").toLowerCase();
  if (lower.includes("bbb.org")) return "bbb";
  if (lower.includes("google.com/maps") || lower.includes("maps.google")) return "google_places";
  return fallback;
}

function upsertPhone(
  phoneMap: Map<string, PhoneGroup>,
  phone: string,
  label: string,
  source: ContactSource,
  verification: string,
): void {
  const key = normalizePhoneKey(phone);
  if (!key || key.length < 10) return;
  const existing = phoneMap.get(key);
  if (existing) {
    if (!existing.labels.includes(label)) existing.labels.push(label);
    addSource(existing.sources, source);
    existing.verification = bestVerification([existing.verification, verification]);
    if (isPrimaryPhoneLabel(label)) existing.isPrimary = true;
    return;
  }
  phoneMap.set(key, {
    key,
    value: phone.trim(),
    display: formatPhone(phone),
    labels: [label],
    verification: normalizeVerification(verification),
    isPrimary: isPrimaryPhoneLabel(label),
    sources: [source],
  });
}

function upsertEmail(
  emailMap: Map<string, EmailGroup>,
  email: string,
  label: string,
  source: ContactSource,
  verification: string,
): void {
  const key = email.trim().toLowerCase();
  if (!key || !key.includes("@") || key.includes("[")) return;
  const existing = emailMap.get(key);
  if (existing) {
    if (!existing.labels.includes(label)) existing.labels.push(label);
    addSource(existing.sources, source);
    existing.verification = bestVerification([existing.verification, verification]);
    return;
  }
  emailMap.set(key, {
    key,
    value: key,
    labels: [label],
    verification: normalizeVerification(verification),
    sources: [source],
  });
}

function upsertPerson(
  personMap: Map<string, PersonGroup>,
  name: string,
  title: string,
  company: string,
  source: ContactSource,
  verification: string,
): void {
  if (!isNamedPerson(name)) return;
  const key = personKey(name);
  const existing = personMap.get(key);
  if (existing) {
    if (title && !existing.title) existing.title = title;
    if (company && !existing.company) existing.company = company;
    addSource(existing.sources, source);
    existing.verification = bestVerification([existing.verification, verification]);
    return;
  }
  personMap.set(key, {
    key,
    name: name.trim(),
    title,
    company,
    verification: normalizeVerification(verification),
    sources: [source],
  });
}

function seedFromSiteContact(
  contact: SiteContact,
  phoneMap: Map<string, PhoneGroup>,
  emailMap: Map<string, EmailGroup>,
  personMap: Map<string, PersonGroup>,
): void {
  const label = (contact.role ?? "").trim() || "Contact";
  const verification = contact.verification ?? "unverified";
  const source: ContactSource = {
    source_kind: sourceKindFromUrl(contact.source_url),
    source_url: contact.source_url ?? "",
    method: "api",
    label,
    quote: cleanQuote(contact.quote),
  };

  if (contact.name) {
    upsertPerson(personMap, contact.name, label, "", source, verification);
  }
  if (contact.phone) {
    const phoneLabel = contact.name?.trim()
      ? `${contact.name.trim()}${label && label !== "Contact" ? ` · ${label}` : ""}`
      : label;
    upsertPhone(phoneMap, contact.phone, phoneLabel, { ...source, label: phoneLabel }, verification);
  }
  if (contact.email_or_form) {
    upsertEmail(emailMap, contact.email_or_form, label, source, verification);
  }
}

export function groupLeadContacts(lead: LeadDetail): GroupedLeadContacts {
  const phoneMap = new Map<string, PhoneGroup>();
  const emailMap = new Map<string, EmailGroup>();
  const personMap = new Map<string, PersonGroup>();
  const socialMap = new Map<string, SocialGroup>();
  let registry: RegistryInfo | null = null;

  for (const fact of lead.facts) {
    // Rejected extractions stay in Explain · evidence, not operator contact lists.
    if (normalizeVerification(fact.verification) === "rejected") {
      continue;
    }

    switch (fact.fact_kind) {
      case "phone": {
        const phone = fact.value.phone ?? "";
        const label = fact.value.label ?? "Phone";
        upsertPhone(phoneMap, phone, label, factSource(fact, label), fact.verification);
        break;
      }
      case "email": {
        const email = fact.value.email ?? "";
        const label = fact.value.label ?? "Email";
        upsertEmail(emailMap, email, label, factSource(fact, label), fact.verification);
        break;
      }
      case "person": {
        const name = (fact.value.name ?? "").trim();
        const title = fact.value.title ?? fact.value.role ?? fact.value.label ?? "";
        const company = fact.value.company ?? "";
        upsertPerson(personMap, name, title, company, factSource(fact, title || "Contact"), fact.verification);
        if (fact.value.phone) {
          const phoneLabel = name ? `${name}${title ? ` · ${title}` : ""}` : title || "Phone";
          upsertPhone(
            phoneMap,
            fact.value.phone,
            phoneLabel,
            factSource(fact, phoneLabel),
            fact.verification,
          );
        }
        if (fact.value.email) {
          upsertEmail(
            emailMap,
            fact.value.email,
            title || name || "Email",
            factSource(fact, title || name || "Email"),
            fact.verification,
          );
        }
        break;
      }
      case "social": {
        const url = fact.value.url ?? fact.source_url;
        const platform = socialPlatformKey(fact.value.platform ?? "", url);
        const key = url.trim().toLowerCase();
        if (!key) break;
        const source = factSource(fact, platform);
        const existing = socialMap.get(key);
        if (existing) {
          addSource(existing.sources, source);
          existing.verification = bestVerification([
            existing.verification,
            fact.verification,
          ]);
        } else {
          socialMap.set(key, {
            key,
            platform,
            url,
            verification: normalizeVerification(fact.verification),
            sources: [source],
          });
        }
        break;
      }
      case "registry_rating": {
        registry = {
          rating: fact.value.rating ?? "",
          accreditedSince: fact.value.accredited_since ?? "",
          businessStarted: fact.value.business_started ?? "",
          yearsInBusiness: fact.value.years_in_business ?? "",
          entityType: fact.value.entity_type ?? "",
          alternateNames: [],
          principals: [],
          sourceUrl: fact.source_url,
        };
        break;
      }
      case "alternate_name": {
        const name = fact.value.name ?? "";
        if (!name) break;
        if (!registry) {
          registry = {
            rating: "",
            accreditedSince: "",
            businessStarted: "",
            yearsInBusiness: "",
            entityType: "",
            alternateNames: [],
            principals: [],
            sourceUrl: fact.source_url,
          };
        }
        if (!registry.alternateNames.includes(name)) {
          registry.alternateNames.push(name);
        }
        break;
      }
      default:
        break;
    }
  }

  for (const contact of lead.site_contacts ?? []) {
    seedFromSiteContact(contact, phoneMap, emailMap, personMap);
  }

  const leadVerification = verificationFromLeadLevel(lead.verification_level);

  if (isNamedPerson(lead.best_contact_name)) {
    upsertPerson(
      personMap,
      lead.best_contact_name!,
      lead.best_contact_role ?? "",
      "",
      {
        source_kind: "lead",
        source_url: lead.website ?? "",
        method: "api",
        label: lead.best_contact_role || "Best contact",
        quote: "",
      },
      leadVerification,
    );
  }

  if (lead.best_contact_phone) {
    upsertPhone(
      phoneMap,
      lead.best_contact_phone,
      "Best contact",
      {
        source_kind: "lead",
        source_url: lead.website ?? "",
        method: "api",
        label: "Best contact",
        quote: "",
      },
      leadVerification,
    );
  }
  const bestKey = lead.best_contact_phone
    ? normalizePhoneKey(lead.best_contact_phone)
    : "";
  if (lead.phone && normalizePhoneKey(lead.phone) !== bestKey) {
    upsertPhone(
      phoneMap,
      lead.phone,
      "Listed phone",
      {
        source_kind: "lead",
        source_url: lead.google_maps_url ?? lead.website ?? "",
        method: "api",
        label: "Listed phone",
        quote: "",
      },
      "unverified",
    );
  }
  if (lead.best_contact_email_or_form) {
    upsertEmail(
      emailMap,
      lead.best_contact_email_or_form,
      "Best contact",
      {
        source_kind: "lead",
        source_url: lead.website ?? "",
        method: "api",
        label: "Best contact",
        quote: "",
      },
      leadVerification,
    );
  }

  const bbbPeople = [...personMap.values()].filter((p) =>
    p.sources.some((s) => s.source_kind === "bbb"),
  );
  if (registry) {
    registry.principals = bbbPeople;
  }

  const phones = [...phoneMap.values()]
    .filter((p) => p.verification !== "rejected")
    .sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      const aMain = a.labels.some(isMainlinePhoneLabel);
      const bMain = b.labels.some(isMainlinePhoneLabel);
      if (aMain !== bMain) return aMain ? 1 : -1;
      return a.display.localeCompare(b.display);
    });

  const emails = [...emailMap.values()]
    .filter((e) => e.verification !== "rejected")
    .sort((a, b) => a.value.localeCompare(b.value));
  const people = [...personMap.values()]
    .filter((p) => p.verification !== "rejected")
    .sort((a, b) => a.name.localeCompare(b.name));
  const socials = [...socialMap.values()].sort((a, b) =>
    a.platform.localeCompare(b.platform),
  );

  return { phones, emails, people, socials, registry };
}

export function sourceDomain(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function primaryLabel(labels: string[]): string {
  if (labels.length === 0) return "Contact";
  const main = labels.find((l) => isPrimaryPhoneLabel(l));
  return main ?? labels[0];
}

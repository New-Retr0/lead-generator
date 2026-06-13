import type { LeadDetail, LeadFact } from "./types";

export type VerificationLevel = "verified" | "corroborated" | "unverified";

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
};

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
  if (value === "verified" || value === "corroborated" || value === "unverified") {
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
  return lower.includes("main") || lower.includes("google places");
}

export function groupLeadContacts(lead: LeadDetail): GroupedLeadContacts {
  const phoneMap = new Map<string, PhoneGroup>();
  const emailMap = new Map<string, EmailGroup>();
  const personMap = new Map<string, PersonGroup>();
  const socialMap = new Map<string, SocialGroup>();
  let registry: RegistryInfo | null = null;

  const seedPhone = (phone: string | null, label: string, sourceUrl: string | null) => {
    if (!phone?.trim()) return;
    const key = normalizePhoneKey(phone);
    if (!key) return;
    const existing = phoneMap.get(key);
    const source: ContactSource = {
      source_kind: "lead",
      source_url: sourceUrl ?? "",
      method: "api",
      label,
      quote: "",
    };
    if (existing) {
      if (!existing.labels.includes(label)) existing.labels.push(label);
      addSource(existing.sources, source);
      if (isPrimaryPhoneLabel(label)) existing.isPrimary = true;
      existing.verification = bestVerification([
        existing.verification,
        "verified",
      ]);
      return;
    }
    phoneMap.set(key, {
      key,
      value: phone.trim(),
      display: formatPhone(phone),
      labels: [label],
      verification: "verified",
      isPrimary: isPrimaryPhoneLabel(label),
      sources: [source],
    });
  };

  for (const fact of lead.facts) {
    switch (fact.fact_kind) {
      case "phone": {
        const phone = fact.value.phone ?? "";
        const label = fact.value.label ?? "Phone";
        const key = normalizePhoneKey(phone);
        if (!key) break;
        const source = factSource(fact, label);
        const existing = phoneMap.get(key);
        if (existing) {
          if (!existing.labels.includes(label)) existing.labels.push(label);
          addSource(existing.sources, source);
          existing.verification = bestVerification([
            existing.verification,
            fact.verification,
          ]);
          if (isPrimaryPhoneLabel(label)) existing.isPrimary = true;
        } else {
          phoneMap.set(key, {
            key,
            value: phone,
            display: formatPhone(phone),
            labels: [label],
            verification: normalizeVerification(fact.verification),
            isPrimary: isPrimaryPhoneLabel(label),
            sources: [source],
          });
        }
        break;
      }
      case "email": {
        const email = (fact.value.email ?? "").trim().toLowerCase();
        const label = fact.value.label ?? "Email";
        if (!email) break;
        const source = factSource(fact, label);
        const existing = emailMap.get(email);
        if (existing) {
          if (!existing.labels.includes(label)) existing.labels.push(label);
          addSource(existing.sources, source);
          existing.verification = bestVerification([
            existing.verification,
            fact.verification,
          ]);
        } else {
          emailMap.set(email, {
            key: email,
            value: email,
            labels: [label],
            verification: normalizeVerification(fact.verification),
            sources: [source],
          });
        }
        break;
      }
      case "person": {
        const name = (fact.value.name ?? "").trim();
        if (!name) break;
        const key = personKey(name);
        const title = fact.value.title ?? "";
        const company = fact.value.company ?? "";
        const source = factSource(fact, title || "Contact");
        const existing = personMap.get(key);
        if (existing) {
          if (title && !existing.title) existing.title = title;
          if (company && !existing.company) existing.company = company;
          addSource(existing.sources, source);
          existing.verification = bestVerification([
            existing.verification,
            fact.verification,
          ]);
        } else {
          personMap.set(key, {
            key,
            name,
            title,
            company,
            verification: normalizeVerification(fact.verification),
            sources: [source],
          });
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

  if (phoneMap.size === 0) {
    seedPhone(lead.phone, "Main line", lead.google_maps_url ?? lead.website);
    seedPhone(lead.best_contact_phone, "Best contact", lead.website);
  }

  const bbbPeople = [...personMap.values()].filter((p) =>
    p.sources.some((s) => s.source_kind === "bbb"),
  );
  if (registry) {
    registry.principals = bbbPeople;
  }

  const phones = [...phoneMap.values()].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.display.localeCompare(b.display);
  });

  const emails = [...emailMap.values()].sort((a, b) => a.value.localeCompare(b.value));
  const people = [...personMap.values()].sort((a, b) => a.name.localeCompare(b.name));
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

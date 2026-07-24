export type SettingsTab = "connections" | "runtime" | "yaml";

export type SettingsGroupId =
  | "Credentials"
  | "Supabase"
  | "Firecrawl"
  | "Enrichment"
  | "Owner Chain"
  | "Quality"
  | "Caching & Archive"
  | "Paths";

export type GroupMeta = {
  id: SettingsGroupId;
  tab: Exclude<SettingsTab, "yaml">;
  title: string;
  short: string;
  description: string;
  /** Highlight as cost-control section */
  costCritical?: boolean;
  /** Collapse by default (reference-only) */
  collapsedByDefault?: boolean;
};

export const GROUP_META: GroupMeta[] = [
  {
    id: "Credentials",
    tab: "connections",
    title: "Provider keys",
    short: "Keys",
    description:
      "API keys the pipeline uses to discover and research leads. A missing key disables that provider — Doctor will flag it.",
  },
  {
    id: "Supabase",
    tab: "connections",
    title: "Database (Supabase)",
    short: "Database",
    description:
      "Where leads, runs, and costs are stored. Changing the database URL requires restarting the dashboard.",
  },
  {
    id: "Firecrawl",
    tab: "runtime",
    title: "Firecrawl research",
    short: "Firecrawl",
    description:
      "Scraping and contact research for the single-pass pipeline. Prefer cheap scrape tiers; agent/Interact only fill named-DM gaps. Runs stop when live team credits hit zero.",
    costCritical: true,
  },
  {
    id: "Enrichment",
    tab: "runtime",
    title: "Enrichment budgets",
    short: "Enrichment",
    description:
      "Per-lead wall-clock and checklist page caps so parallel workers cannot pin a market cell forever.",
  },
  {
    id: "Owner Chain",
    tab: "runtime",
    title: "Owner chain",
    short: "Owner chain",
    description:
      "Deep SOS/recorder agent lookups after cheaper tiers. Most expensive per-lead step — keep the run cap low.",
    costCritical: true,
  },
  {
    id: "Quality",
    tab: "runtime",
    title: "Quality & reopen",
    short: "Quality",
    description:
      "Verified = named DM (first+last + role + local phone) — not a score. These knobs control when researched misses and time-boxed duds are tried again.",
  },
  {
    id: "Caching & Archive",
    tab: "runtime",
    title: "Caching & archive",
    short: "Cache",
    description:
      "Local SQLite caches avoid re-paying for pages and payloads you already fetched.",
  },
  {
    id: "Paths",
    tab: "runtime",
    title: "Local paths",
    short: "Paths",
    description: "Computed on-disk locations for config, data, and exports. Read-only.",
    collapsedByDefault: true,
  },
];

/** Ordered subsections inside the Firecrawl group. */
export type FirecrawlSection = {
  id: string;
  title: string;
  description: string;
  fields: readonly string[];
  emphasize?: boolean;
  collapsedByDefault?: boolean;
};

export const FIRECRAWL_SECTIONS: FirecrawlSection[] = [
  {
    id: "cost",
    title: "Cost brakes",
    description:
      "Hard caps before long campaigns. Agent max credits 0 disables capped /agent (contact-gap + owner-chain).",
    emphasize: true,
    fields: ["firecrawl_agent_max_credits"],
  },
  {
    id: "scrape",
    title: "Scrape & cache",
    description:
      'Primary fetch path. Prefer proxy "basic" (1 credit); escalate to auto only on dead-end pages.',
    fields: [
      "firecrawl_scrape_proxy",
      "firecrawl_proxy_escalate",
      "firecrawl_timeout_ms",
      "firecrawl_scrape_max_age_ms",
      "firecrawl_search_recency",
    ],
  },
  {
    id: "escalate",
    title: "Contact escalation",
    description:
      "When Tier-1/2 still lack a named DM: Interact (cheap UI expand) before capped agent. Search feedback may refund junk Tier-2 queries.",
    fields: [
      "firecrawl_interact_enabled",
      "firecrawl_interact_timeout_s",
      "firecrawl_search_feedback",
      "firecrawl_agent_model",
      "firecrawl_agent_timeout_s",
    ],
  },
  {
    id: "advanced",
    title: "Advanced / opt-in",
    description:
      "Circuit breakers and optional Verified-page monitors (recurring scrape credits — off by default).",
    collapsedByDefault: true,
    fields: [
      "firecrawl_grounding_storm_limit",
      "firecrawl_429_circuit_cooldown_s",
      "firecrawl_monitor_ready_pages",
      "firecrawl_monitor_cron",
    ],
  },
];

/** Preferred field order within non-Firecrawl groups (unknown fields append alphabetically). */
export const GROUP_FIELD_ORDER: Partial<Record<SettingsGroupId, readonly string[]>> = {
  Enrichment: ["enrichment_lead_timeout_s", "source_checklist_max_pages"],
  Quality: ["researched_miss_reopen_days", "dud_reopen_days"],
  "Caching & Archive": [
    "page_cache_ttl_days",
    "domain_cache_ttl_hours",
    "raw_capture_enabled",
    "raw_capture_max_bytes",
    "local_cache_path",
    "raw_archive_path",
  ],
  "Owner Chain": ["owner_chain_max_per_run"],
};

export const FIELD_TITLE_OVERRIDES: Record<string, string> = {
  firecrawl_agent_max_credits: "Agent max credits",
  google_places_api_key: "Google Places API key",
  firecrawl_api_key: "Firecrawl API key",
  supabase_db_url: "Postgres connection URL",
  supabase_service_role_key: "Service role key",
  supabase_anon_key: "Anon key",
};

export const CONNECTION_STATUS_FIELDS = [
  {
    name: "google_places_api_key",
    label: "Google Places",
    hint: "Discovery",
  },
  {
    name: "firecrawl_api_key",
    label: "Firecrawl",
    hint: "Research + owner chain",
  },
  {
    name: "supabase_db_url",
    label: "Supabase DB",
    hint: "Canonical store",
  },
] as const;

export type YamlCategory = {
  id: string;
  title: string;
  description: string;
  files: string[];
};

export const YAML_CATEGORIES: YamlCategory[] = [
  {
    id: "geo",
    title: "Geography & campaigns",
    description: "Where to run — search radius lives in markets.yaml, not .env",
    files: ["campaign.yaml", "markets.yaml"],
  },
  {
    id: "enrich",
    title: "Research playbooks",
    description: "Per-category behavior, search templates, registries, portals",
    files: [
      "categories.yaml",
      "search_templates.yaml",
      "sources.yaml",
      "licensing.yaml",
      "jurisdictions.yaml",
    ],
  },
  {
    id: "roles",
    title: "Decision-maker roles",
    description: "Canonical DM roles shared by Python, SQL, and the dashboard",
    files: ["decision_roles.yaml"],
  },
  {
    id: "costs",
    title: "Costs",
    description: "Provider pricing estimates for the cost ledger",
    files: ["pricing.yaml"],
  },
];

export const TAB_META: Record<
  SettingsTab,
  { label: string; title: string; blurb: string }
> = {
  connections: {
    label: "Connections",
    title: "Keys & database",
    blurb: "Credentials written to .env so the pipeline can call providers and Postgres.",
  },
  runtime: {
    label: "Run behavior",
    title: "Spend & research knobs",
    blurb:
      "Credit caps, scrape/proxy, named-DM escalation, and reopen windows. Saved to .env — apply before launching runs. Discovery radius is in markets.yaml.",
  },
  yaml: {
    label: "YAML configs",
    title: "Markets, categories, pricing",
    blurb:
      "Structured playbooks in config/*.yaml (markets, categories, decision roles, pricing). Validate before save; backups go to config/.backups.",
  },
};

export function groupAnchorId(group: string): string {
  return `settings-${group.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export function orderGroupFields(
  group: string,
  fields: string[],
): string[] {
  if (group === "Firecrawl") {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const section of FIRECRAWL_SECTIONS) {
      for (const name of section.fields) {
        if (fields.includes(name) && !seen.has(name)) {
          ordered.push(name);
          seen.add(name);
        }
      }
    }
    for (const name of [...fields].sort()) {
      if (!seen.has(name)) ordered.push(name);
    }
    return ordered;
  }

  const preferred = GROUP_FIELD_ORDER[group as SettingsGroupId];
  if (!preferred) {
    return [...fields].sort();
  }
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const name of preferred) {
    if (fields.includes(name)) {
      ordered.push(name);
      seen.add(name);
    }
  }
  for (const name of [...fields].sort()) {
    if (!seen.has(name)) ordered.push(name);
  }
  return ordered;
}

export function parseSettingsTab(value: string | null | undefined): SettingsTab {
  if (value === "connections" || value === "runtime" || value === "yaml") {
    return value;
  }
  // Legacy ?tab=pipeline|config
  if (value === "pipeline" || value === "config") {
    return value === "config" ? "yaml" : "runtime";
  }
  return "connections";
}

export type SettingsTab = "connections" | "runtime" | "yaml";

export type SettingsGroupId =
  | "Credentials"
  | "Supabase"
  | "Discovery"
  | "Firecrawl"
  | "Owner Chain"
  | "Caching & Archive"
  | "Scoring"
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
    id: "Discovery",
    tab: "runtime",
    title: "Discovery (Google Places)",
    short: "Discovery",
    description:
      "How wide and deep each Places search goes. Larger radius / page size finds more businesses but costs ~$0.035 per request.",
  },
  {
    id: "Firecrawl",
    tab: "runtime",
    title: "Firecrawl research",
    short: "Firecrawl",
    description:
      "Scraping and research engine for the single-pass pipeline. Concurrency and place-parallelism follow your Firecrawl plan; runs stop when live team credits hit zero.",
    costCritical: true,
  },
  {
    id: "Owner Chain",
    tab: "runtime",
    title: "Owner chain",
    short: "Owner chain",
    description:
      "Deep owner lookups via Firecrawl agent (SOS, recorder, parcel). Most expensive per-lead step.",
    costCritical: true,
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
    id: "Scoring",
    tab: "runtime",
    title: "Scoring & export",
    short: "Scoring",
    description:
      "How leads are ranked and which scores make it into exports. Learned score stays at weight 0 until validated.",
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

/** Firecrawl credit-related fields shown first in the Firecrawl group callout. */
export const FIRECRAWL_SPEND_FIELDS = ["firecrawl_agent_max_credits"] as const;

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
    description: "Where to run and which category matrix to use",
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
    id: "learn",
    title: "Costs & learning",
    description: "Provider pricing estimates and optional learned score coefficients",
    files: ["pricing.yaml", "learned_score.yaml"],
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
    blurb: "Runtime limits and scoring. Saved to .env — apply before launching runs.",
  },
  yaml: {
    label: "YAML configs",
    title: "Markets, categories, pricing",
    blurb: "Structured playbooks in config/*.yaml. Validate before save; backups go to config/.backups.",
  },
};

export function groupAnchorId(group: string): string {
  return `settings-${group.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
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

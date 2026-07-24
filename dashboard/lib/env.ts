import { existsSync, readFileSync } from "fs";
import path from "path";
import { projectRoot } from "./paths";

/** Load KEY=VALUE pairs from the repo-root `.env` for spawned CLI children. */
export function loadProjectEnv(): Record<string, string> {
  const envPath = path.join(projectRoot(), ".env");
  if (!existsSync(envPath)) {
    return {};
  }

  const parsed: Record<string, string> = {};
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

/** Only forward known pipeline secrets/settings into spawned CLI children. */
const CLI_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "VIRTUAL_ENV",
  "PYTHONPATH",
  "PYTHONIOENCODING",
  "PYTHONUTF8",
  "PALLARES_LOG_JSON",
  "GOOGLE_PLACES_API_KEY",
  "FIRECRAWL_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DB_URL",
  "FIRECRAWL_TIMEOUT_MS",
  "FIRECRAWL_SCRAPE_MAX_AGE_MS",
  "FIRECRAWL_SCRAPE_PROXY",
  "FIRECRAWL_PROXY_ESCALATE",
  "FIRECRAWL_AGENT_MAX_CREDITS",
  "FIRECRAWL_AGENT_MODEL",
  "FIRECRAWL_AGENT_TIMEOUT_S",
  "FIRECRAWL_INTERACT_ENABLED",
  "FIRECRAWL_INTERACT_TIMEOUT_S",
  "FIRECRAWL_SEARCH_FEEDBACK",
  "FIRECRAWL_MONITOR_READY_PAGES",
  "FIRECRAWL_MONITOR_CRON",
  "FIRECRAWL_GROUNDING_STORM_LIMIT",
  "FIRECRAWL_429_CIRCUIT_COOLDOWN_S",
  "FIRECRAWL_SEARCH_RECENCY",
  "ENRICHMENT_LEAD_TIMEOUT_S",
  "PAGE_CACHE_TTL_DAYS",
  "DOMAIN_CACHE_TTL_HOURS",
  "RAW_CAPTURE_ENABLED",
  "RAW_CAPTURE_MAX_BYTES",
  "RESEARCHED_MISS_REOPEN_DAYS",
  "DUD_REOPEN_DAYS",
  "OWNER_CHAIN_MAX_PER_RUN",
  "SOURCE_CHECKLIST_MAX_PAGES",
  "LEARNED_SCORE_WEIGHT",
  "LEARNED_SCORE_MIN_LABELS",
] as const;

function pickAllowed(source: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of CLI_ENV_ALLOWLIST) {
    const value = source[key];
    if (value !== undefined && value !== "") {
      out[key] = value;
    }
  }
  return out;
}

export function cliChildEnv(): NodeJS.ProcessEnv {
  const fromFile = loadProjectEnv();
  const fromProcess = pickAllowed(process.env as Record<string, string | undefined>);
  return {
    ...pickAllowed(fromFile),
    ...fromProcess,
    PYTHONIOENCODING: process.env.PYTHONIOENCODING ?? "utf-8",
    PYTHONUTF8: process.env.PYTHONUTF8 ?? "1",
    PALLARES_LOG_JSON: process.env.PALLARES_LOG_JSON ?? "1",
  } as unknown as NodeJS.ProcessEnv;
}

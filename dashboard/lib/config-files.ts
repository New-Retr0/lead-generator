import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import path from "path";
import { projectRoot } from "./paths";

export const CONFIG_FILE_DESCRIPTIONS: Record<string, string> = {
  "campaign.yaml": "Market × category matrix for run-campaign and smoke-sample",
  "markets.yaml": "Geography (cities, bbox, counties) and Places search_radius_m",
  "categories.yaml": "Per-category discovery and research behavior",
  "pricing.yaml": "USD estimates for cost tracking by provider",
  "search_templates.yaml": "Firecrawl search query templates by category",
  "licensing.yaml": "State licensing/registry lookup configuration",
  "jurisdictions.yaml": "County recorder and portal URLs",
  "sources.yaml": "Automatic source checklist tiers per lead",
  "decision_roles.yaml": "Canonical decision-maker roles (sync to Python/SQL/TS)",
  "learned_score.yaml": "Learned score coefficients (written by insights --fit-score)",
};

export const LEARNED_SCORE_WARNING =
  "This file is normally written by pallares-leads insights --fit-score. Manual edits may be overwritten.";

const CONFIG_NAME_RE = /^[a-z0-9_]+\.yaml$/i;

export function configDir(): string {
  return path.join(projectRoot(), "config");
}

export function isAllowedConfigName(name: string): boolean {
  if (!CONFIG_NAME_RE.test(name)) {
    return false;
  }
  const resolved = path.resolve(configDir(), name);
  const base = path.resolve(configDir());
  return resolved.startsWith(`${base}${path.sep}`) || resolved === base;
}

export function resolveConfigPath(name: string): string {
  if (!isAllowedConfigName(name)) {
    throw new Error("Invalid config file name");
  }
  return path.join(configDir(), name);
}

export type ConfigFileSummary = {
  name: string;
  size: number;
  mtime: string;
  description: string;
  warnManualEdit: boolean;
};

export function listConfigFiles(): ConfigFileSummary[] {
  const dir = configDir();
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .filter((name) => name.endsWith(".yaml") && isAllowedConfigName(name))
    .map((name) => {
      const full = path.join(dir, name);
      const stat = statSync(full);
      return {
        name,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        description: CONFIG_FILE_DESCRIPTIONS[name] ?? "Pipeline configuration",
        warnManualEdit: name === "learned_score.yaml",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function readConfigFile(name: string): string {
  const filePath = resolveConfigPath(name);
  if (!existsSync(filePath)) {
    throw new Error("Config file not found");
  }
  return readFileSync(filePath, "utf8");
}

export function writeConfigFile(name: string, content: string): void {
  const filePath = resolveConfigPath(name);
  const backupDir = path.join(configDir(), ".backups");
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
  }
  if (existsSync(filePath)) {
    writeFileSync(path.join(backupDir, `${name}.bak`), readFileSync(filePath, "utf8"), "utf8");
  }
  writeFileSync(filePath, content, "utf8");
}

import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { projectRoot } from "./paths";

export const DASHBOARD_RESTART_KEYS = new Set(["SUPABASE_DB_URL"]);

export function fieldToEnvKey(fieldName: string): string {
  return fieldName.toUpperCase();
}

function envFilePath(): string {
  return path.join(projectRoot(), ".env");
}

function formatEnvValue(value: string | number | boolean): string {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return String(value);
  }
  const text = String(value);
  if (/[\s#="'\\]/.test(text)) {
    return `"${text.replace(/"/g, '\\"')}"`;
  }
  return text;
}

function parseEnvKey(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }
  const eq = trimmed.indexOf("=");
  if (eq <= 0) {
    return null;
  }
  return trimmed.slice(0, eq).trim();
}

export type EnvUpdateResult = {
  written: string[];
  removed: string[];
  restartRequired: string[];
};

/** Upsert or remove keys in repo-root `.env`, preserving comments and unrelated lines. */
export function updateProjectEnv(
  updates: Record<string, string | number | boolean | null>,
): EnvUpdateResult {
  const envPath = envFilePath();
  const written: string[] = [];
  const removed: string[] = [];
  const restartRequired: string[] = [];

  const pending = new Map<string, string | number | boolean | null>();
  for (const [field, value] of Object.entries(updates)) {
    pending.set(fieldToEnvKey(field), value);
  }

  const lines: string[] = existsSync(envPath)
    ? readFileSync(envPath, "utf8").split(/\r?\n/)
    : [];

  const seen = new Set<string>();
  const output: string[] = [];

  for (const line of lines) {
    const key = parseEnvKey(line);
    if (!key || !pending.has(key)) {
      output.push(line);
      continue;
    }

    const value = pending.get(key);
    pending.delete(key);
    seen.add(key);

    if (value === null || value === undefined) {
      removed.push(key);
      if (DASHBOARD_RESTART_KEYS.has(key)) {
        restartRequired.push(key);
      }
      continue;
    }

    output.push(`${key}=${formatEnvValue(value)}`);
    written.push(key);
    if (DASHBOARD_RESTART_KEYS.has(key)) {
      restartRequired.push(key);
    }
  }

  const appendKeys = [...pending.entries()].filter(([, value]) => value !== null);
  if (appendKeys.length > 0) {
    if (output.length > 0 && output[output.length - 1] !== "") {
      output.push("");
    }
    output.push("# added by dashboard settings");
    for (const [key, value] of appendKeys) {
      if (value === null) {
        continue;
      }
      output.push(`${key}=${formatEnvValue(value)}`);
      written.push(key);
      if (DASHBOARD_RESTART_KEYS.has(key)) {
        restartRequired.push(key);
      }
    }
  }

  writeFileSync(envPath, `${output.join("\n").replace(/\n?$/, "\n")}`, "utf8");

  return { written, removed, restartRequired: [...new Set(restartRequired)] };
}

export function listEnvKeys(): string[] {
  const envPath = envFilePath();
  if (!existsSync(envPath)) {
    return [];
  }
  const keys: string[] = [];
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const key = parseEnvKey(line);
    if (key) {
      keys.push(key);
    }
  }
  return keys;
}

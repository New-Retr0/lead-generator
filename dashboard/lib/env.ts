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

/** Dashboard-only vars — must not leak into spawned Python (breaks Settings.project_root). */
const DASHBOARD_ONLY_ENV = new Set(["PROJECT_ROOT", "PALLARES_DB_PATH"]);

export function cliChildEnv(): NodeJS.ProcessEnv {
  const nodeEnv: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !DASHBOARD_ONLY_ENV.has(key)) {
      nodeEnv[key] = value;
    }
  }
  return {
    ...loadProjectEnv(),
    ...nodeEnv,
    PYTHONIOENCODING: process.env.PYTHONIOENCODING ?? "utf-8",
    PYTHONUTF8: process.env.PYTHONUTF8 ?? "1",
    PALLARES_LOG_JSON: process.env.PALLARES_LOG_JSON ?? "1",
  };
}

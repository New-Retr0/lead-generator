#!/usr/bin/env node
/** Push required production env vars to Vercel (reads repo-root .env). */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const salesDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootEnv = resolve(salesDir, "..", ".env");

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const i = trimmed.indexOf("=");
    out[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
  return out;
}

function vercel(args, input) {
  const proc = spawnSync("npx", ["vercel", ...args], {
    cwd: salesDir,
    input,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return proc;
}

const env = loadEnv(rootEnv);
const vars = {
  NEXT_PUBLIC_SUPABASE_URL: env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
  PROJECT_ROOT: "..",
};

for (const [key, value] of Object.entries(vars)) {
  if (!value) {
    console.error(`Missing ${key} in ${rootEnv}`);
    process.exit(1);
  }
}

const target = "production";
for (const key of Object.keys(vars)) {
  vercel(["env", "rm", key, target, "--yes"]);
}

for (const [key, value] of Object.entries(vars)) {
  let proc = vercel(["env", "add", key, target, "--value", value, "--yes"]);
  if (proc.status !== 0) {
    proc = vercel(["env", "add", key, target, "--yes"], `${value}\n`);
  }
  if (proc.status !== 0) {
    console.error(proc.stdout);
    console.error(proc.stderr);
    process.exit(1);
  }
  console.log(`set ${key}`);
}

console.log("Done. Run: npx vercel deploy --prod --yes");

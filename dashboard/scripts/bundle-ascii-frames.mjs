#!/usr/bin/env node
/**
 * Bundle per-frame ASCII .txt files into a single frames.json per folder/quality.
 * One HTTP request (~gzip 300–400KB) beats 100–200 parallel GETs on hero mounts.
 * Skips rewrite when frames.json is already newer than every frame_*.txt.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const animationsDir = path.join(root, "public", "animations");

const FOLDERS = ["planet", "cube", "computer", "wave"];
const QUALITIES = ["low", "medium"];

function bundleFolder(folder, quality) {
  const dir = path.join(animationsDir, folder, quality);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((name) => /^frame_\d+\.txt$/i.test(name))
    .sort();
  if (files.length === 0) return null;

  const outPath = path.join(dir, "frames.json");
  let newestFrameMtime = 0;
  for (const name of files) {
    const mtime = statSync(path.join(dir, name)).mtimeMs;
    if (mtime > newestFrameMtime) newestFrameMtime = mtime;
  }

  if (existsSync(outPath) && statSync(outPath).mtimeMs >= newestFrameMtime) {
    const kb = Math.round(statSync(outPath).size / 1024);
    return { folder, quality, count: files.length, kb, skipped: true };
  }

  const frames = files.map((name) => readFileSync(path.join(dir, name), "utf8"));
  writeFileSync(outPath, JSON.stringify(frames));
  const kb = Math.round(statSync(outPath).size / 1024);
  return { folder, quality, count: frames.length, kb, skipped: false };
}

const results = [];
for (const folder of FOLDERS) {
  for (const quality of QUALITIES) {
    const result = bundleFolder(folder, quality);
    if (result) results.push(result);
  }
}

if (results.length === 0) {
  console.warn("[bundle-ascii-frames] no frame sets found");
  process.exit(0);
}

const wrote = results.filter((r) => !r.skipped);
const skipped = results.filter((r) => r.skipped);
if (wrote.length === 0) {
  console.log(
    `[bundle-ascii-frames] up to date (${skipped.length} sets, skipped rewrite)`,
  );
} else {
  for (const r of wrote) {
    console.log(
      `[bundle-ascii-frames] ${r.folder}/${r.quality}: ${r.count} frames → ${r.kb} KB`,
    );
  }
  if (skipped.length > 0) {
    console.log(`[bundle-ascii-frames] skipped ${skipped.length} up-to-date set(s)`);
  }
}

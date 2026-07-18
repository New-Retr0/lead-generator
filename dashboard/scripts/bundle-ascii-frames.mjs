#!/usr/bin/env node
/**
 * Bundle per-frame ASCII .txt files into a single frames.json per folder/quality.
 * One HTTP request (~gzip 300–400KB) beats 100–200 parallel GETs on hero mounts.
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
  const frames = files.map((name) => readFileSync(path.join(dir, name), "utf8"));
  const outPath = path.join(dir, "frames.json");
  writeFileSync(outPath, JSON.stringify(frames));
  const kb = Math.round(statSync(outPath).size / 1024);
  return { folder, quality, count: frames.length, kb, outPath };
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

for (const r of results) {
  console.log(`[bundle-ascii-frames] ${r.folder}/${r.quality}: ${r.count} frames → ${r.kb} KB`);
}

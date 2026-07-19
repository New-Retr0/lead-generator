#!/usr/bin/env node
/**
 * All-in-one local dashboard start (reliable path for Safari):
 *   next dev on http://127.0.0.1:3000
 *
 * Portless HTTPS (pallares.localhost) breaks Safari HMR: browsers block
 * ws:// from https:// pages, and the system Portless proxy on :443 often
 * cannot upgrade WebSockets over HTTP/2. Use `npm run dev:portless` only
 * after restarting that proxy with portless ≥0.15.
 */
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_PORT = "3000";

function pidsListeningOnPort(port) {
  try {
    const out = spawnSync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
      { encoding: "utf8" },
    ).stdout;
    return String(out ?? "")
      .split(/\s+/)
      .map((value) => Number.parseInt(value, 10))
      .filter((pid) => Number.isFinite(pid) && pid > 0 && pid !== process.pid);
  } catch {
    return [];
  }
}

function freePort(port) {
  for (const pid of pidsListeningOnPort(port)) {
    try {
      process.kill(pid, "SIGTERM");
      console.log(`[dev] stopped PID ${pid} on :${port}`);
    } catch {
      // ignore
    }
  }
}

freePort(APP_PORT);

console.log(`[dev] Dashboard → http://127.0.0.1:${APP_PORT}`);
console.log("[dev] (Safari-stable. Named URL: npm run dev:portless after proxy restart)");

const child = spawn(
  process.execPath,
  [
    path.join(dashboardRoot, "node_modules/next/dist/bin/next"),
    "dev",
    "-H",
    "127.0.0.1",
    "-p",
    APP_PORT,
  ],
  {
    stdio: "inherit",
    cwd: dashboardRoot,
    env: {
      ...process.env,
      PORT: APP_PORT,
      HOST: "127.0.0.1",
    },
  },
);

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (child.exitCode == null && !child.killed) {
    try {
      child.kill(signal);
    } catch {
      // ignore
    }
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

child.on("exit", (code, signal) => {
  process.exit(signal ? 0 : (code ?? 0));
});

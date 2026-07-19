#!/usr/bin/env node
/**
 * All-in-one local dashboard start:
 *   1. Ensure Portless HTTPS proxy (:443)
 *   2. Prune orphaned Portless-managed servers
 *   3. Run Next through `portless run` on fixed :3456 → https://pallares.localhost
 *
 * From repo root or dashboard/: `npm run dev`
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_PORT = "3456";
const APP_NAME = "pallares";
const PUBLIC_URL = `https://${APP_NAME}.localhost`;
const portlessCli = path.join(dashboardRoot, "node_modules/portless/dist/cli.js");

function run(command, args, opts = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    ...opts,
  });
}

function portless(args, opts = {}) {
  return spawnSync(process.execPath, [portlessCli, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    cwd: dashboardRoot,
    ...opts,
  });
}

function pidsListeningOnPort(port) {
  try {
    return run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"])
      .split(/\s+/)
      .map((value) => Number.parseInt(value, 10))
      .filter((pid) => Number.isFinite(pid) && pid > 0 && pid !== process.pid);
  } catch {
    return [];
  }
}

function httpOk(url, timeoutSec = 2) {
  try {
    const code = run("curl", [
      "-sk",
      "-o",
      "/dev/null",
      "-w",
      "%{http_code}",
      "--max-time",
      String(timeoutSec),
      url,
    ]).trim();
    return code.startsWith("2") || code.startsWith("3");
  } catch {
    return false;
  }
}

function sleep(ms) {
  try {
    run("sleep", [String(ms / 1000)]);
  } catch {
    // ignore
  }
}

/** Browsers use HTTP/2 → Portless needs RFC 8441 (portless ≥0.15) for wss HMR. */
function hmrWebSocketOk() {
  try {
    const code = run("curl", [
      "-sk",
      "-o",
      "/dev/null",
      "-w",
      "%{http_code}",
      "--max-time",
      "4",
      "-H",
      "Connection: Upgrade",
      "-H",
      "Upgrade: websocket",
      "-H",
      "Sec-WebSocket-Version: 13",
      "-H",
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
      `${PUBLIC_URL}/_next/webpack-hmr?id=healthcheck`,
    ]).trim();
    return code === "101";
  } catch {
    return false;
  }
}

function warnHmrProxy() {
  if (hmrWebSocketOk()) return;
  console.warn(
    "[dev] Portless cannot proxy HMR WebSockets over HTTP/2 yet (Safari will loop if we fall back to ws://).\n" +
      "  Fast Refresh is stubbed off for https://*.localhost so the page stays stable.\n" +
      "  For real HMR: restart the system proxy (needs sudo), or use npm run dev:direct:\n" +
      "    npx portless proxy stop && npx portless proxy start",
  );
}

function ensurePortlessProxy() {
  const result = portless(["proxy", "start"]);
  const out = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status === 0 || /already|running/i.test(out)) {
    console.log("[dev] Portless proxy ready on :443");
    return true;
  }
  console.warn(
    "[dev] Could not start Portless proxy.\n" +
      "  Run once in a terminal: npx portless proxy start && npx portless hosts sync",
  );
  return false;
}

function syncHostsBestEffort() {
  // Safari needs /etc/hosts; may prompt for sudo — ignore failure in agent shells.
  portless(["hosts", "sync"], { stdio: "ignore" });
}

function pruneOrphans() {
  const result = portless(["prune"]);
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (out) console.log(`[dev] portless prune: ${out}`);
}

function portlessRouteActive() {
  const result = portless(["list"]);
  const out = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return (
    out.includes(`${APP_NAME}.localhost`) &&
    (out.includes(`:${APP_PORT}`) || out.includes(`localhost:${APP_PORT}`))
  );
}

function killPids(pids) {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
      console.log(`[dev] stopped PID ${pid}`);
    } catch {
      // ignore
    }
  }
}

function freeAppPort() {
  const pids = pidsListeningOnPort(APP_PORT);
  if (pids.length === 0) return;
  console.log(`[dev] freeing :${APP_PORT}…`);
  killPids(pids);
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && pidsListeningOnPort(APP_PORT).length > 0) {
    sleep(100);
  }
  for (const pid of pidsListeningOnPort(APP_PORT)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ignore
    }
  }
}

async function attachToExisting() {
  console.log(`[dev] already serving → ${PUBLIC_URL}`);
  console.log(`[dev] (Portless route + :${APP_PORT} healthy — not restarting)`);
  await new Promise((resolve) => {
    const timer = setInterval(() => {
      if (pidsListeningOnPort(APP_PORT).length === 0 || !portlessRouteActive()) {
        clearInterval(timer);
        console.log("[dev] backend/route went away. Run npm run dev again.");
        resolve(undefined);
      }
    }, 2000);
    const stop = () => {
      clearInterval(timer);
      resolve(undefined);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
  process.exit(0);
}

function startPortlessNext() {
  console.log(`[dev] starting Next via Portless → ${PUBLIC_URL} (backend :${APP_PORT})`);
  const child = spawn(
    process.execPath,
    [
      portlessCli,
      "run",
      "--name",
      APP_NAME,
      "--force",
      "--app-port",
      APP_PORT,
      "next",
      "dev",
      "--webpack",
      "-H",
      "127.0.0.1",
      "-p",
      APP_PORT,
    ],
    { stdio: "inherit", cwd: dashboardRoot, detached: false },
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
    // Never re-signal this process — that produced `zsh: terminated`.
    process.exit(signal ? 0 : (code ?? 0));
  });
}

// ── main ────────────────────────────────────────────────────────────
ensurePortlessProxy();
syncHostsBestEffort();
pruneOrphans();
warnHmrProxy();

const routeOk = portlessRouteActive();
const backendOk =
  pidsListeningOnPort(APP_PORT).length > 0 &&
  httpOk(`http://127.0.0.1:${APP_PORT}/`, 12);
const namedOk = httpOk(`${PUBLIC_URL}/`, 8);

// Only attach when Portless still owns the route. Orphan Next on :3456
// (stale routes.json / "No active routes") is what left the UI half-dead.
if (routeOk && backendOk && namedOk) {
  await attachToExisting();
} else {
  if (!routeOk && backendOk) {
    console.log("[dev] orphan backend on :3456 (no Portless route) — restarting clean");
  } else if (pidsListeningOnPort(APP_PORT).length > 0 && !backendOk) {
    console.log("[dev] unhealthy backend on :3456 — restarting clean");
  }
  freeAppPort();
  startPortlessNext();
}

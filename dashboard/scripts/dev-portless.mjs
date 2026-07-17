import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function staleNextPidsWindows() {
  const root = dashboardRoot.replace(/'/g, "''");
  const script = `
$root = '${root}'.ToLower()
Get-CimInstance Win32_Process |
  Where-Object {
    $_.ProcessId -ne ${process.pid} -and
    $_.CommandLine -and
    $_.CommandLine.ToLower().Contains($root) -and
    $_.CommandLine -match 'next[\\\\/]dist[\\\\/]server[\\\\/]lib[\\\\/]start-server\\.js'
  } |
  Select-Object -ExpandProperty ProcessId
`;
  try {
    return run("powershell.exe", ["-NoProfile", "-Command", script])
      .split(/\s+/)
      .map((value) => Number.parseInt(value, 10))
      .filter(Number.isFinite);
  } catch {
    return [];
  }
}

function staleNextPidsPosix() {
  try {
    return run("ps", ["-eo", "pid=,args="])
      .split("\n")
      .map((line) => {
        const match = line.trim().match(/^(\d+)\s+(.*)$/);
        if (!match) return null;
        const pid = Number.parseInt(match[1], 10);
        const args = match[2];
        if (pid === process.pid) return null;
        if (!args.includes(dashboardRoot)) return null;
        if (!args.includes("next/dist/server/lib/start-server.js")) return null;
        return pid;
      })
      .filter((pid) => pid != null);
  } catch {
    return [];
  }
}

const stalePids =
  process.platform === "win32" ? staleNextPidsWindows() : staleNextPidsPosix();

for (const pid of stalePids) {
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else {
      process.kill(pid, "SIGTERM");
    }
    console.log(`Stopped existing dashboard dev server (PID ${pid}).`);
  } catch {
    // If the process exited between discovery and cleanup, continue.
  }
}

const portlessCli = path.join(dashboardRoot, "node_modules", "portless", "dist", "cli.js");
const child = spawn(
  process.execPath,
  [portlessCli, "run", "--name", "pallares", "--force", "next", "dev"],
  { stdio: "inherit" },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

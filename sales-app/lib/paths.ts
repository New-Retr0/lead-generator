import { existsSync } from "fs";
import path from "path";

export function projectRoot(): string {
  const root = process.env.PROJECT_ROOT ?? "..";
  if (path.isAbsolute(root)) {
    return root;
  }
  const resolved = path.resolve(/* turbopackIgnore: true */ process.cwd(), root);
  // Vercel deploy: config copied into sales-app/config at build time
  if (!existsSync(path.join(resolved, "config", "markets.yaml"))) {
    const local = path.resolve(process.cwd(), "config");
    if (existsSync(path.join(local, "markets.yaml"))) {
      return process.cwd();
    }
  }
  return resolved;
}

export function dbPath(): string {
  const configured = process.env.PALLARES_DB_PATH ?? "../data/pallares.db";
  if (path.isAbsolute(configured)) {
    return configured;
  }
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), configured);
}

export function resolveCli(): { command: string; baseArgs: string[]; cwd: string } {
  const root = projectRoot();
  const win = process.platform === "win32";
  const venvBin = path.join(root, ".venv", win ? "Scripts" : "bin");
  const python = path.join(venvBin, win ? "python.exe" : "python");
  const pallaresCli = path.join(venvBin, win ? "pallares-leads.exe" : "pallares-leads");

  // Prefer `python -m` so editable installs always pick up current source (exe can go stale).
  if (existsSync(python)) {
    return { command: python, baseArgs: ["-m", "pallares_leads.cli"], cwd: root };
  }
  if (existsSync(pallaresCli)) {
    return { command: pallaresCli, baseArgs: [], cwd: root };
  }
  return { command: win ? "python" : "python3", baseArgs: ["-m", "pallares_leads.cli"], cwd: root };
}

/** Human-readable command string with args that contain spaces quoted. */
export function formatCliCommand(command: string, baseArgs: string[], args: string[]): string {
  const quote = (part: string) => (/\s/.test(part) ? `"${part.replace(/"/g, '\\"')}"` : part);
  return [command, ...baseArgs, ...args].map(quote).join(" ");
}

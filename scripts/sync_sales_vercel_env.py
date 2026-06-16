#!/usr/bin/env python3
"""Sync sales-app Vercel env vars from repo-root .env (non-interactive)."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SALES = ROOT / "sales-app"
ENV_FILE = ROOT / ".env"
ENVIRONMENTS = ("production",)


def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        out[key.strip()] = value.strip()
    return out


def build_sales_env(root_env: dict[str, str]) -> dict[str, str]:
    mapping = {
        "NEXT_PUBLIC_SUPABASE_URL": root_env.get("SUPABASE_URL") or root_env.get("NEXT_PUBLIC_SUPABASE_URL", ""),
        "NEXT_PUBLIC_SUPABASE_ANON_KEY": root_env.get("SUPABASE_ANON_KEY")
        or root_env.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", ""),
        "PROJECT_ROOT": "..",
    }
    return {k: v for k, v in mapping.items() if v}


def run(cmd: list[str], *, input_text: str | None = None) -> subprocess.CompletedProcess[str]:
    full_cmd = ["npx", "vercel", *cmd[1:]] if cmd[0] == "vercel" else cmd
    return subprocess.run(
        full_cmd,
        cwd=SALES,
        input=input_text,
        text=True,
        capture_output=True,
        check=False,
        shell=True,
    )


def remove_var(name: str, env: str) -> None:
    run(["vercel", "env", "rm", name, env, "--yes"])


def add_var(name: str, value: str, env: str) -> None:
    # Prefer --value/--yes; fall back to stdin for older CLI.
    proc = run(["vercel", "env", "add", name, env, "--value", value, "--yes"])
    if proc.returncode != 0 and "unknown" in (proc.stderr + proc.stdout).lower():
        proc = run(["vercel", "env", "add", name, env, "--yes"], input_text=f"{value}\n")
    if proc.returncode != 0:
        print(proc.stdout)
        print(proc.stderr, file=sys.stderr)
        raise RuntimeError(f"Failed to set {name} for {env}")


def main() -> int:
    root_env = load_env(ENV_FILE)
    sales_env = build_sales_env(root_env)
    if not sales_env.get("NEXT_PUBLIC_SUPABASE_URL"):
        print("Missing SUPABASE_URL in .env", file=sys.stderr)
        return 1
    if not sales_env.get("NEXT_PUBLIC_SUPABASE_ANON_KEY"):
        print("Missing SUPABASE_ANON_KEY in .env", file=sys.stderr)
        return 1

    for env in ENVIRONMENTS:
        print(f"\n== {env} ==")
        for key in sales_env:
            remove_var(key, env)
        for key, value in sales_env.items():
            add_var(key, value, env)
            print(f"  set {key}")

    print("\nDone. Redeploy with: cd sales-app && vercel deploy --prod --yes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

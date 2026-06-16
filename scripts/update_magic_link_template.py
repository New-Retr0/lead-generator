#!/usr/bin/env python3
"""Update hosted Supabase magic-link email template (token_hash for cross-device PKCE)."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "supabase" / "templates" / "magic_link.html"
PROJECT_REF = "aufbppdxjybopacabsbk"


def load_dotenv() -> None:
    env = ROOT / ".env"
    if not env.is_file():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())


def main() -> int:
    load_dotenv()
    if not TEMPLATE.is_file():
        print(f"Missing {TEMPLATE}", file=sys.stderr)
        return 1

    content = TEMPLATE.read_text(encoding="utf-8")
    subject = "Your PALLARES Sales sign-in link"

    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if not token:
        # Supabase CLI stores personal access token here on Windows.
        for candidate in (
            Path.home() / ".supabase" / "access-token",
            Path(os.environ.get("APPDATA", "")) / "supabase" / "access-token",
            Path(os.environ.get("USERPROFILE", "")) / ".supabase" / "access-token",
        ):
            if candidate.is_file():
                token = candidate.read_text(encoding="utf-8").strip()
                break

    if not token:
        print(
            "No SUPABASE_ACCESS_TOKEN — paste this template in Supabase Dashboard:\n"
            "  Authentication → Email Templates → Magic Link\n",
            file=sys.stderr,
        )
        print(content)
        return 1

    url = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/config/auth"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    payload = {
        "mailer_autoconfirm": False,
        "mailer_subjects_magic_link": subject,
        "mailer_templates_magic_link_content": content,
    }

    with httpx.Client(timeout=60) as client:
        resp = client.patch(url, headers=headers, json=payload)

    if resp.status_code >= 400:
        print(f"Management API failed ({resp.status_code}): {resp.text[:500]}", file=sys.stderr)
        print("\nPaste manually in Dashboard → Auth → Email Templates → Magic Link:\n")
        print(content)
        return 1

    print("Updated magic-link email template to use token_hash (cross-device sign-in).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

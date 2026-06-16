#!/usr/bin/env python3
"""Generate admin magic link for a user (token_hash flow test)."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]


def load_dotenv() -> None:
    env = ROOT / ".env"
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())


def main() -> int:
    load_dotenv()
    email = (sys.argv[1] if len(sys.argv) > 1 else "kalevp11@gmail.com").lower()
    base = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    redirect = "https://pallares-sales.vercel.app/auth/confirm"
    headers = {"Authorization": f"Bearer {key}", "apikey": key, "Content-Type": "application/json"}
    payload = {
        "type": "magiclink",
        "email": email,
        "options": {"redirect_to": redirect},
    }
    with httpx.Client(timeout=30) as client:
        resp = client.post(f"{base}/auth/v1/admin/generate_link", headers=headers, json=payload)
    if resp.status_code >= 400:
        print(resp.status_code, resp.text, file=sys.stderr)
        return 1
    data = resp.json()
    print(json.dumps({k: data.get(k) for k in ("action_link", "email_otp", "hashed_token")}, indent=2))
    props = data.get("properties") or {}
    link = props.get("action_link") or data.get("action_link")
    if link:
        print(f"\nAction link:\n{link}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Print a one-time cross-device sign-in URL (admin generate_link + token_hash)."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib.parse import quote

import httpx

ROOT = Path(__file__).resolve().parents[1]
APP_ORIGIN = os.environ.get("SALES_APP_ORIGIN", "https://pallares-sales.vercel.app").rstrip("/")
CONFIRM_PATH = "/auth/confirm"


def load_dotenv() -> None:
    env = ROOT / ".env"
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())


def sign_in_url(email: str) -> str:
    base = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"Authorization": f"Bearer {key}", "apikey": key, "Content-Type": "application/json"}
    redirect = f"{APP_ORIGIN}{CONFIRM_PATH}"
    payload = {
        "type": "magiclink",
        "email": email.strip().lower(),
        "options": {"redirect_to": redirect},
    }
    with httpx.Client(timeout=30) as client:
        resp = client.post(f"{base}/auth/v1/admin/generate_link", headers=headers, json=payload)
    resp.raise_for_status()
    data = resp.json()
    props = data.get("properties") if isinstance(data.get("properties"), dict) else {}
    token = data.get("hashed_token") or props.get("hashed_token")
    if not token:
        raise RuntimeError(f"No hashed_token in response: {data}")
    q = f"token_hash={quote(str(token))}&type=magiclink"
    return f"{APP_ORIGIN}{CONFIRM_PATH}?{q}"


def main() -> int:
    load_dotenv()
    emails = sys.argv[1:] or ["kalevp11@gmail.com", "info@pallares.us"]
    for email in emails:
        try:
            print(f"{email}:\n  {sign_in_url(email)}\n")
        except Exception as exc:
            print(f"{email}: ERROR {exc}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

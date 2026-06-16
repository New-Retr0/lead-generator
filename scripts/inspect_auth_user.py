#!/usr/bin/env python3
"""Inspect Supabase Auth user by email (admin API)."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]


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


def find_user(email: str) -> dict | None:
    base = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"Authorization": f"Bearer {key}", "apikey": key}
    page = 1
    with httpx.Client(timeout=30) as client:
        while True:
            resp = client.get(
                f"{base}/auth/v1/admin/users",
                headers=headers,
                params={"page": page, "per_page": 200},
            )
            resp.raise_for_status()
            body = resp.json()
            users = body.get("users", body if isinstance(body, list) else [])
            for user in users:
                if (user.get("email") or "").lower() == email.lower():
                    return user
            if len(users) < 200:
                return None
            page += 1


def main() -> int:
    load_dotenv()
    emails = sys.argv[1:] or ["kalevp11@gmail.com", "info@pallares.us"]
    for email in emails:
        user = find_user(email)
        if not user:
            print(f"{email}: NOT FOUND")
            continue
        print(f"{email}:")
        print(f"  id: {user.get('id')}")
        print(f"  email_confirmed_at: {user.get('email_confirmed_at')}")
        print(f"  banned_until: {user.get('banned_until')}")
        print(f"  created_at: {user.get('created_at')}")
        print(f"  last_sign_in_at: {user.get('last_sign_in_at')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

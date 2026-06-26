#!/usr/bin/env python3
"""Delete Supabase Auth users through the Admin API."""

from __future__ import annotations

import argparse
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
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def admin_headers(service_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {service_key}",
        "apikey": service_key,
        "Content-Type": "application/json",
    }


def find_user_by_email(
    client: httpx.Client,
    base_url: str,
    headers: dict[str, str],
    email: str,
) -> dict | None:
    page = 1
    while True:
        resp = client.get(
            f"{base_url}/auth/v1/admin/users",
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
    parser = argparse.ArgumentParser(description="Delete Supabase Auth users by email.")
    parser.add_argument("emails", nargs="+", help="Email address(es) to delete")
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Required confirmation for deletion",
    )
    args = parser.parse_args()

    load_dotenv()
    base_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base_url or not service_key:
        print("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env", file=sys.stderr)
        return 1
    if not args.yes:
        print("Deletion requires --yes", file=sys.stderr)
        return 1

    headers = admin_headers(service_key)
    with httpx.Client(timeout=30) as client:
        for email in args.emails:
            user = find_user_by_email(client, base_url, headers, email.strip().lower())
            if not user:
                print(f"{email}: not found")
                continue
            user_id = user["id"]
            resp = client.delete(f"{base_url}/auth/v1/admin/users/{user_id}", headers=headers)
            if resp.status_code >= 400:
                print(f"{email}: delete failed ({resp.status_code}): {resp.text}", file=sys.stderr)
                return 1
            print(f"{email}: deleted")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

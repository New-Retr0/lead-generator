#!/usr/bin/env python3
"""Create or confirm a Supabase Auth user (admin-only, no self-signup)."""

from __future__ import annotations

import argparse
import os
import sys

import httpx


def admin_headers(service_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {service_key}",
        "apikey": service_key,
        "Content-Type": "application/json",
    }


def find_user_by_email(client: httpx.Client, base: str, headers: dict[str, str], email: str):
    page = 1
    while True:
        resp = client.get(
            f"{base}/auth/v1/admin/users",
            headers=headers,
            params={"page": page, "per_page": 200},
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"list users failed ({resp.status_code}): {resp.text}")
        body = resp.json()
        users = body.get("users", body if isinstance(body, list) else [])
        for user in users:
            if (user.get("email") or "").lower() == email.lower():
                return user
        if len(users) < 200:
            return None
        page += 1


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Create or confirm a user in Supabase Auth (required before magic-link sign-in)",
    )
    parser.add_argument("email", help="Rep email address")
    args = parser.parse_args()

    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not service_key:
        print("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env", file=sys.stderr)
        return 1

    email = args.email.strip().lower()
    headers = admin_headers(service_key)

    with httpx.Client(timeout=30) as client:
        existing = find_user_by_email(client, base, headers, email)
        if existing:
            uid = existing["id"]
            resp = client.put(
                f"{base}/auth/v1/admin/users/{uid}",
                headers=headers,
                json={"email_confirm": True},
            )
            if resp.status_code >= 400:
                print(f"Confirm failed ({resp.status_code}): {resp.text}", file=sys.stderr)
                return 1
            print(f"Confirmed existing user {email} — magic link sign-in is enabled.")
            return 0

        resp = client.post(
            f"{base}/auth/v1/admin/users",
            headers=headers,
            json={"email": email, "email_confirm": True},
        )
        if resp.status_code >= 400:
            print(f"Create failed ({resp.status_code}): {resp.text}", file=sys.stderr)
            return 1
        print(f"Created and confirmed {email} — magic link sign-in is enabled.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

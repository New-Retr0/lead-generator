#!/usr/bin/env python3
"""Smoke-check Supabase connectivity and RLS expectations."""

from __future__ import annotations

import os
import sys

import httpx
import psycopg


def main() -> int:
    db_url = os.environ.get("SUPABASE_DB_URL", "")
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    anon = os.environ.get("SUPABASE_ANON_KEY", "")
    service = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

    if not db_url:
        print("SKIP: SUPABASE_DB_URL not set", file=sys.stderr)
        return 1

    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM leads")
            leads = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM sales_leads")
            sales = cur.fetchone()[0]
    print(f"OK postgres: {leads} leads, {sales} sales_leads rows")

    if base and anon:
        r = httpx.get(
            f"{base}/rest/v1/leads?select=place_id&limit=1",
            headers={"apikey": anon, "Authorization": f"Bearer {anon}"},
            timeout=20,
        )
        # anon without user JWT should be blocked by RLS
        if r.status_code == 200 and r.json():
            print("WARN: anon key read leads without user JWT (unexpected)")
        else:
            print(f"OK anon REST blocked or empty ({r.status_code})")

    if base and service:
        r = httpx.get(
            f"{base}/rest/v1/leads?select=place_id&limit=1",
            headers={"apikey": service, "Authorization": f"Bearer {service}"},
            timeout=20,
        )
        if r.status_code == 200:
            print("OK service role can read leads (bypasses RLS)")
        else:
            print(f"FAIL service role read: {r.status_code}", file=sys.stderr)
            return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

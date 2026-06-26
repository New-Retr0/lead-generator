#!/usr/bin/env python3
"""Create a hashed partner API key for the Supabase Edge Function."""

from __future__ import annotations

import argparse
import hashlib
import os
import secrets
import sys
from pathlib import Path

import psycopg

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


def make_key() -> str:
    return f"ppl_{secrets.token_urlsafe(36)}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Create or rotate a partner API key.")
    parser.add_argument("--partner", default="Ben / Pallares", help="Partner label")
    parser.add_argument("--rate-limit", type=int, default=60, help="Requests per minute")
    parser.add_argument("--daily-row-limit", type=int, default=10000, help="Rows per UTC day")
    parser.add_argument(
        "--deactivate-existing",
        action="store_true",
        help="Deactivate existing active keys for this partner before inserting the new one",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "secrets" / "partner_api_key_ben.txt",
        help="Where to write the one-time plaintext key",
    )
    args = parser.parse_args()

    load_dotenv()
    db_url = os.environ.get("SUPABASE_DB_URL", "")
    if not db_url:
        print("Set SUPABASE_DB_URL in .env", file=sys.stderr)
        return 1

    api_key = make_key()
    key_prefix = api_key[:16]
    key_hash = hashlib.sha256(api_key.encode("utf-8")).hexdigest()

    with psycopg.connect(db_url, autocommit=True) as conn:
        with conn.cursor() as cur:
            if args.deactivate_existing:
                cur.execute(
                    """
                    update public.partner_api_keys
                    set active = false
                    where partner_name = %s and active = true
                    """,
                    (args.partner,),
                )
            cur.execute(
                """
                insert into public.partner_api_keys (
                  key_prefix,
                  key_hash,
                  partner_name,
                  scopes,
                  rate_limit_per_minute,
                  daily_row_limit
                )
                values (%s, %s, %s, array['leads:read'], %s, %s)
                returning id
                """,
                (
                    key_prefix,
                    key_hash,
                    args.partner,
                    args.rate_limit,
                    args.daily_row_limit,
                ),
            )
            key_id = cur.fetchone()[0]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        (
            f"Partner: {args.partner}\n"
            f"Key ID: {key_id}\n"
            f"API Key: {api_key}\n"
            "Header: Authorization: Bearer <API Key>\n"
        ),
        encoding="utf-8",
    )
    print(f"Created partner API key {key_id}")
    print(f"Plaintext key written to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

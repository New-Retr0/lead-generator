#!/usr/bin/env python3
"""Ensure a sales rep can sign in (create + confirm, or confirm existing invite)."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Register a rep for magic-link sign-in (no self-signup)",
    )
    parser.add_argument("email", help="Rep email address")
    args = parser.parse_args()

    script = os.path.join(os.path.dirname(__file__), "create_auth_user.py")
    return subprocess.call([sys.executable, script, args.email.strip()])


if __name__ == "__main__":
    raise SystemExit(main())

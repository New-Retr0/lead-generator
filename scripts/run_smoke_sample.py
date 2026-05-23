"""Smoke sample: 5 fully enriched leads per category (Reedley by default).

Usage:
  python scripts/run_smoke_sample.py
  python scripts/run_smoke_sample.py --all-markets
  python scripts/run_smoke_sample.py --market reedley,fresno --limit 3
"""

from __future__ import annotations

import sys

from pallares_leads.cli import main

if __name__ == "__main__":
    if len(sys.argv) == 1:
        sys.argv.extend(["smoke-sample"])
    elif sys.argv[1] not in {"smoke-sample", "-h", "--help"}:
        sys.argv.insert(1, "smoke-sample")
    main()

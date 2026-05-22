from __future__ import annotations

import argparse
import logging
import sys

from pallares_leads.config_loader import load_categories, load_markets
from pallares_leads.discover.places import PlacesClient
from pallares_leads.pipeline.run_market import run_market_category
from pallares_leads.settings import get_settings


def _configure_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    )


def cmd_run(args: argparse.Namespace) -> int:
    settings = get_settings()
    markets = load_markets(settings.config_dir)
    categories = load_categories(settings.config_dir)

    if args.market not in markets:
        print(f"Unknown market {args.market!r}. Options: {', '.join(sorted(markets))}", file=sys.stderr)
        return 1

    market = markets[args.market]

    if args.all_categories:
        cat_keys = list(categories.keys())
    elif args.category:
        if args.category not in categories:
            print(
                f"Unknown category {args.category!r}. Options: {', '.join(sorted(categories))}",
                file=sys.stderr,
            )
            return 1
        cat_keys = [args.category]
    else:
        print("Specify --category or --all-categories", file=sys.stderr)
        return 1

    for cat_key in cat_keys:
        run_market_category(
            settings=settings,
            market_key=args.market,
            market=market,
            category_key=cat_key,
            category=categories[cat_key],
            discover_only=args.discover_only,
            dry_run=args.dry_run,
        )

    return 0


def cmd_list_config(_args: argparse.Namespace) -> int:
    settings = get_settings()
    markets = load_markets(settings.config_dir)
    categories = load_categories(settings.config_dir)
    print("Markets:", ", ".join(sorted(markets)))
    print("Categories:", ", ".join(sorted(categories)))
    return 0


def cmd_doctor(_args: argparse.Namespace) -> int:
    settings = get_settings()
    ok = True

    if not settings.google_places_api_key:
        print("Places API (New): MISSING — set GOOGLE_PLACES_API_KEY in .env")
        print("  Setup guide: docs/GOOGLE-PLACES-SETUP.md")
        ok = False
    else:
        client = PlacesClient(settings)
        places_ok, places_msg = client.health_check()
        status = "OK" if places_ok else "FAIL"
        print(f"Places API (New): {status} — {places_msg}")
        ok = ok and places_ok

    if not settings.firecrawl_api_key:
        print("Firecrawl: MISSING — set FIRECRAWL_API_KEY in .env (needed for enrichment)")
    else:
        print("Firecrawl: configured (not probed — scrape costs credits)")

    return 0 if ok else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="pallares-leads", description="PALLARES lead pipeline")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="Run discovery (+ optional enrichment) for a market")
    run.add_argument("--market", required=True, help="Market key from config/markets.yaml")
    run.add_argument("--category", help="Category key from config/categories.yaml")
    run.add_argument("--all-categories", action="store_true")
    run.add_argument("--discover-only", action="store_true", help="Skip Firecrawl enrichment")
    run.add_argument("--dry-run", action="store_true", help="Print queries only")
    run.set_defaults(func=cmd_run)

    lst = sub.add_parser("list", help="List configured markets and categories")
    lst.set_defaults(func=cmd_list_config)

    doc = sub.add_parser("doctor", help="Verify API keys and Places API (New) connectivity")
    doc.set_defaults(func=cmd_doctor)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    _configure_logging(args.verbose)
    raise SystemExit(args.func(args))


if __name__ == "__main__":
    main()

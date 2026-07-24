from __future__ import annotations

import argparse
import json
import logging
import sys
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from pallares_leads.config_loader import load_campaigns, load_categories, load_markets
from pallares_leads.db.store import LeadStore
from pallares_leads.discover.mgmt_directory import (
    expand_portfolio_from_profile,
    harvest_management_directory,
)
from pallares_leads.discover.places import PlacesClient
from pallares_leads.enrich.firecrawl_client import FirecrawlClient
from pallares_leads.pipeline.run_campaign import DEFAULT_CAMPAIGN, run_campaign
from pallares_leads.pipeline.run_market import run_market_category
from pallares_leads.request.fulfill import fulfill_request
from pallares_leads.request.planner import estimate_request_cost, parse_lead_request, spec_from_dict
from pallares_leads.settings import Settings, get_settings
from pallares_leads.utils.run_lock import PipelineLockedError, pipeline_lock

SMOKE_SAMPLE_LIMIT = 5


def _redact_connection_url(value: str) -> str:
    try:
        parsed = urlsplit(value)
    except ValueError:
        return "<configured>"
    if not parsed.scheme or not parsed.netloc:
        return value
    host = parsed.netloc.rsplit("@", 1)[-1]
    netloc = f"<credentials>@{host}" if "@" in parsed.netloc else host
    return urlunsplit((parsed.scheme, netloc, parsed.path, "", ""))


def _format_cli_timestamp(value: object) -> str:
    if isinstance(value, datetime):
        return value.isoformat(sep=" ", timespec="seconds")[:19]
    if value is None:
        return "unknown"
    return str(value)[:19]


def _configure_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    )


def _print_campaign_summary(summary) -> None:
    print(f"\nCampaign complete: {summary.total_leads} lead(s) exported")
    for result in summary.results:
        if result.error:
            print(f"  FAIL  {result.market_key}/{result.category_key}: {result.error}")
        else:
            print(f"  OK    {result.market_key}/{result.category_key}: {result.lead_count} lead(s)")


def _add_lead_db_flags(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--no-skip-known",
        action="store_false",
        dest="skip_known",
        help="Process all discovered leads even if already researched in the DB",
    )
    parser.set_defaults(skip_known=True)
    parser.add_argument(
        "--refresh-after-days",
        type=int,
        metavar="N",
        help="Re-research leads last processed more than N days ago",
    )


def _run_db_kwargs(args: argparse.Namespace) -> dict:
    return {
        "skip_known": args.skip_known,
        "force_refresh": False,
        "refresh_after_days": args.refresh_after_days,
    }


def _run_under_pipeline_lock(settings: Settings, body: Callable[[], int]) -> int:
    """Single-instance guard + repair zombie runs before pipeline work."""
    log = logging.getLogger(__name__)
    try:
        with pipeline_lock(settings.data_dir):
            with LeadStore() as store:
                repaired = store.repair_stuck_runs(older_than_hours=2)
                if repaired:
                    log.info("Repaired %d stuck run(s)", repaired)
            return body()
    except PipelineLockedError as exc:
        print(str(exc), file=sys.stderr)
        return 1


def cmd_run(args: argparse.Namespace) -> int:
    settings = get_settings()

    markets = load_markets(settings.config_dir)
    categories = load_categories(settings.config_dir)

    if not args.market:
        print("Specify --market", file=sys.stderr)
        return 1

    if args.market not in markets:
        print(
            f"Unknown market {args.market!r}. Options: {', '.join(sorted(markets))}",
            file=sys.stderr,
        )
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

    db_kwargs = _run_db_kwargs(args)

    def _body() -> int:
        for cat_key in cat_keys:
            run_market_category(
                settings=settings,
                market_key=args.market,
                market=market,
                category_key=cat_key,
                category=categories[cat_key],
                discover_only=args.discover_only,
                dry_run=args.dry_run,
                limit=args.limit,
                **db_kwargs,
            )
        return 0

    return _run_under_pipeline_lock(settings, _body)


def cmd_run_campaign(args: argparse.Namespace) -> int:
    settings = get_settings()
    market_filter = args.market.split(",") if args.market else None
    category_filter = args.category.split(",") if args.category else None

    def _body() -> int:
        try:
            summary = run_campaign(
                settings=settings,
                campaign_key=args.campaign,
                limit=args.limit,
                discover_only=args.discover_only,
                dry_run=args.dry_run,
                market_filter=market_filter,
                category_filter=category_filter,
                **_run_db_kwargs(args),
            )
        except ValueError as exc:
            print(str(exc), file=sys.stderr)
            return 1

        _print_campaign_summary(summary)
        return 1 if summary.failures else 0

    return _run_under_pipeline_lock(settings, _body)


def cmd_smoke_sample(args: argparse.Namespace) -> int:
    """Run a small fully-researched sample (default: Reedley, 5 leads per category)."""
    settings = get_settings()

    if not settings.firecrawl_api_key and not args.discover_only:
        print(
            "FIRECRAWL_API_KEY is required for full research. "
            "Set it in .env or pass --discover-only.",
            file=sys.stderr,
        )
        return 1

    market_filter = None
    if args.all_markets:
        market_filter = None
    elif args.market:
        market_filter = [m.strip() for m in args.market.split(",")]
    else:
        market_filter = ["reedley"]

    limit = args.limit or SMOKE_SAMPLE_LIMIT
    print(
        f"Smoke sample: campaign={args.campaign!r}, markets={market_filter or 'all'}, "
        f"limit={limit}, research={'yes' if not args.discover_only else 'no'}"
    )

    def _body() -> int:
        try:
            summary = run_campaign(
                settings=settings,
                campaign_key=args.campaign,
                limit=limit,
                discover_only=args.discover_only,
                dry_run=args.dry_run,
                market_filter=market_filter,
                **_run_db_kwargs(args),
            )
        except ValueError as exc:
            print(str(exc), file=sys.stderr)
            return 1

        _print_campaign_summary(summary)
        if summary.failures:
            return 1

        return 0

    return _run_under_pipeline_lock(settings, _body)


def cmd_list_config(_args: argparse.Namespace) -> int:
    settings = get_settings()
    markets = load_markets(settings.config_dir)
    categories = load_categories(settings.config_dir)
    campaigns = load_campaigns(settings.config_dir)
    print("Markets:", ", ".join(sorted(markets)))
    print("Categories:", ", ".join(sorted(categories)))
    print("Campaigns:", ", ".join(sorted(campaigns)))
    for key, campaign in sorted(campaigns.items()):
        overrides = campaign.get("county_overrides") or {}
        markets_n = len(campaign["markets"])
        categories_n = len(campaign["categories"])
        print(f"  {key}: {markets_n} markets × {categories_n} categories")
        if overrides:
            print(f"    county overrides: {overrides}")
    return 0


def cmd_settings_schema(_args: argparse.Namespace) -> int:
    from pallares_leads.settings_schema import print_settings_schema

    return print_settings_schema()


def _doctor_json_report(settings: Settings) -> dict:
    """Compact structured health report for dashboards (`doctor --json`)."""
    checks: list[dict[str, object]] = []
    ok = True

    if not settings.google_places_api_key:
        checks.append(
            {
                "service": "Places API (New)",
                "status": "missing",
                "message": "GOOGLE_PLACES_API_KEY unset",
                "details": [],
            }
        )
        ok = False
    else:
        places_ok, places_msg = PlacesClient(settings).health_check()
        checks.append(
            {
                "service": "Places API (New)",
                "status": "ok" if places_ok else "fail",
                "message": places_msg,
                "details": [],
            }
        )
        ok = ok and places_ok

    if not settings.firecrawl_api_key:
        checks.append(
            {
                "service": "Firecrawl",
                "status": "missing",
                "message": "FIRECRAWL_API_KEY unset",
                "details": [],
            }
        )
    else:
        fc = FirecrawlClient(settings)
        fc_ok, fc_msg = fc.health_check()
        checks.append(
            {
                "service": "Firecrawl",
                "status": "ok" if fc_ok else "fail",
                "message": fc_msg,
                "details": [],
            }
        )
        ok = ok and fc_ok

    if not settings.supabase_db_url:
        checks.append(
            {
                "service": "Supabase",
                "status": "missing",
                "message": "SUPABASE_DB_URL unset",
                "details": [],
            }
        )
        ok = False
    else:
        checks.append(
            {
                "service": "Supabase",
                "status": "ok",
                "message": "configured",
                "details": [],
            }
        )

    with LeadStore() as store:
        lead_count = store.count_leads()
        enriched_count = store.count_enriched()
        checks.append(
            {
                "service": "Lead database",
                "status": "ok",
                "message": f"{lead_count} lead(s), {enriched_count} researched",
                "details": [_redact_connection_url(store.db_path)],
            }
        )

    return {"ok": ok, "checks": checks}


def cmd_doctor(args: argparse.Namespace) -> int:
    settings = get_settings()
    if getattr(args, "json", False):
        report = _doctor_json_report(settings)
        print(json.dumps(report, indent=2, default=str))
        return 0 if report["ok"] else 1

    ok = True

    if getattr(args, "config", False):
        from pallares_leads.config_loader import validate_all_config

        problems = validate_all_config(settings.config_dir)
        if problems:
            print("Config validation: FAIL")
            for problem in problems:
                print(f"  - {problem}")
            ok = False
        else:
            print("Config validation: OK")

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
        print("Firecrawl: MISSING — set FIRECRAWL_API_KEY in .env (needed for research)")
    else:
        from pallares_leads.enrich.firecrawl_client import FirecrawlClient

        fc = FirecrawlClient(settings)
        fc_ok, fc_msg = fc.health_check()
        status = "OK" if fc_ok else "FAIL"
        print(f"Firecrawl: {status} — {fc_msg}")
        ok = ok and fc_ok
        queue = fc.get_queue_status()
        queue_max_conc = fc.plan_max_concurrency()
        if queue.get("error"):
            print(f"  Firecrawl queue: unavailable ({queue['error'][:80]})")
        else:
            jobs = queue.get("jobsInQueue", queue.get("jobs_in_queue"))
            if jobs is not None or queue_max_conc is not None:
                print(
                    f"  Firecrawl queue: {jobs or 0} queued, "
                    f"plan concurrency {queue_max_conc or '?'}"
                )
        from pallares_leads.costs import infer_firecrawl_plan, load_pricing

        pricing = load_pricing(settings.config_dir)
        _, inferred_plan = infer_firecrawl_plan(
            pricing, max_concurrency=queue_max_conc
        )
        plan_concurrency = queue_max_conc or (
            int(inferred_plan.get("concurrent_browsers") or 0) if inferred_plan else None
        )
        if inferred_plan:
            limits = inferred_plan.get("rate_limits_rpm") or {}
            print(
                f"  Plan status: {inferred_plan.get('name', 'unknown')} "
                f"({int(inferred_plan.get('monthly_credits') or 0):,} credits/mo, "
                f"{plan_concurrency or '?'} concurrent browsers, "
                f"{limits.get('scrape', '?')} scrape rpm, {limits.get('search', '?')} search rpm)"
            )
        else:
            print("  Plan status: unavailable from Firecrawl API")
        effective = fc.effective_max_concurrency()
        workers = fc.effective_parallel_workers()
        print(
            f"  Concurrency: {effective} from Firecrawl plan "
            f"(place-parallel workers: {workers})"
        )

    if not settings.supabase_db_url:
        print("Supabase: MISSING — set SUPABASE_DB_URL in .env")
        ok = False
    else:
        print("Supabase: configured (SUPABASE_DB_URL)")

    with LeadStore() as store:
        lead_count = store.count_leads()
        enriched_count = store.count_enriched()
        repaired = store.repair_stuck_runs()
        if repaired:
            print(f"  Repaired {repaired} stuck run(s) marked as failed")
        db_label = _redact_connection_url(store.db_path)
        print(f"Lead DB: {db_label} — {lead_count} lead(s), {enriched_count} researched")

        if settings.firecrawl_api_key:
            from pallares_leads.enrich.firecrawl_client import FirecrawlClient

            fc_balance = FirecrawlClient(settings, store=store).get_team_credit_usage()
            remaining = fc_balance.get("remainingCredits", fc_balance.get("remaining_credits"))
            plan = fc_balance.get("planCredits", fc_balance.get("plan_credits"))
            used = fc_balance.get("usedCredits", fc_balance.get("used_credits"))
            billing_end = fc_balance.get("billingPeriodEnd", fc_balance.get("billing_period_end"))
            if remaining is not None:
                detail = f"{float(remaining):.0f} credits remaining"
                if plan is not None:
                    detail += f" of {float(plan):.0f} plan credits"
                print(f"  Firecrawl balance snapshot: {detail}")
                if used is None and plan is not None:
                    try:
                        used = max(0.0, float(plan) - float(remaining))
                    except (TypeError, ValueError):
                        used = None
                from pallares_leads.costs import (
                    firecrawl_credit_usd,
                    infer_firecrawl_plan,
                    load_pricing,
                )

                pricing = load_pricing(settings.config_dir)
                _, inferred_plan = infer_firecrawl_plan(pricing, plan_credits=plan)
                if inferred_plan:
                    print(
                        f"  Firecrawl plan snapshot: {inferred_plan.get('name', 'unknown')} "
                        f"({int(inferred_plan.get('monthly_credits') or 0):,} credits/mo, "
                        f"${firecrawl_credit_usd(pricing, plan_credits=plan):.6f}/credit)"
                    )
                extra = fc_balance.get("extraCredits")
                if extra is None and plan is not None and remaining is not None:
                    try:
                        extra = max(0.0, float(remaining) - float(plan))
                    except (TypeError, ValueError):
                        extra = None
                if extra is not None and float(extra) > 0:
                    print(
                        f"  Extra/recharge credits beyond plan: {float(extra):.0f}"
                    )
                if used is not None and plan is not None:
                    pct = (float(used) / float(plan)) * 100 if float(plan) > 0 else 0
                    print(f"  Billing cycle usage: {float(used):.0f} credits ({pct:.1f}% of plan)")
                    if pct >= 80:
                        print(
                            f"  WARNING: over 80% of monthly plan credits used "
                            f"({pct:.1f}%) — review spend before starting large runs"
                        )
                if billing_end:
                    print(f"  Billing period ends: {billing_end}")
                    if used is not None:
                        try:
                            from datetime import datetime

                            end_dt = datetime.fromisoformat(str(billing_end).replace("Z", "+00:00"))
                            now = datetime.now(UTC)
                            days_left = max((end_dt - now).total_seconds() / 86400, 0)
                            row = store._conn.execute(
                                """
                                SELECT COALESCE(SUM(units), 0) AS total
                                FROM cost_events
                                WHERE provider = 'firecrawl'
                                  AND created_at >= NOW() - INTERVAL '7 days'
                                """
                            ).fetchone()
                            recent_total = float(row["total"] if row else 0)
                            recent_daily = recent_total / 7 if recent_total > 0 else 0.0
                            if recent_daily > 0:
                                projected = float(used) + recent_daily * days_left
                                plan_f = float(plan or 0)
                                over = projected > plan_f
                                print(
                                    f"  Projected cycle-end usage: {projected:.0f} credits "
                                    f"({'over' if over else 'under'} plan, "
                                    f"{recent_daily:.0f}/day 7d avg)"
                                )
                        except (TypeError, ValueError, OSError):
                            pass
            elif fc_balance.get("error"):
                print(f"  Firecrawl balance snapshot: unavailable ({fc_balance['error'][:80]})")
            elif remaining is not None and float(remaining) <= 0:
                print("  WARNING: Firecrawl credits exhausted — research will fail with HTTP 402")

        if settings.owner_chain_max_per_run > 0 and settings.firecrawl_api_key:
            print(
                f"Owner chain: Firecrawl agent "
                f"(cap {settings.owner_chain_max_per_run} lookups/run)"
            )

    return 0 if ok else 1


def cmd_db_status(args: argparse.Namespace) -> int:
    with LeadStore() as store:
        print(f"Database: {_redact_connection_url(store.db_path)}")
        print(f"  Total leads:    {store.count_leads()}")
        print(f"  Researched:     {store.count_enriched()}")
        runs = store.recent_runs(limit=args.limit)
        if runs:
            print(f"\nRecent runs (last {len(runs)}):")
            for run in runs:
                label = run["run_type"]
                if run["market_key"]:
                    label += f" {run['market_key']}/{run['category_key']}"
                print(
                    f"  {_format_cli_timestamp(run['started_at'])}  {label}  "
                    f"discovered={run['discovered_count']}  "
                    f"skipped={run['skipped_known_count']}  "
                    f"completed={run['enriched_count']}  "
                    f"{run['status']}"
                )
        else:
            print("\nNo runs recorded yet.")
            if store.count_leads() == 0:
                print("Import existing CSV/JSONL: pallares-leads db import")
    return 0


def cmd_db_import(args: argparse.Namespace) -> int:
    settings = get_settings()
    with LeadStore() as store:
        before = store.count_leads()
        if args.csv:
            path = Path(args.csv)
            if not path.is_file():
                print(f"CSV not found: {path}", file=sys.stderr)
                return 1
            imported = store.import_from_csv(path)
            print(f"Imported {imported} lead(s) from {path.name}")
        elif args.jsonl:
            path = Path(args.jsonl)
            if not path.is_file():
                print(f"JSONL not found: {path}", file=sys.stderr)
                return 1
            imported = store.import_from_jsonl(path)
            print(f"Imported {imported} lead(s) from {path.name}")
        else:
            jsonl_count, csv_count = store.import_existing_data(settings)
            print(f"Imported from data/: {jsonl_count} from raw JSONL, {csv_count} from output CSV")
        after = store.count_leads()
        print(f"Database: {after} lead(s) total ({after - before} new)")
    return 0


def cmd_db_profiles(args: argparse.Namespace) -> int:
    with LeadStore() as store:
        profiles = store.list_profiles(limit=args.limit)
        print(f"Research profiles: {store.count_profiles()} total\n")
        for row in profiles:
            playbook = row.get("playbook") or {}
            print(
                f"  {row['profile_key']}  successes={row['success_count']}  "
                f"tier={playbook.get('winning_tier', '—')}  "
                f"skip_firecrawl={playbook.get('skip_firecrawl', False)}"
            )
    return 0


def cmd_db_lead(args: argparse.Namespace) -> int:
    with LeadStore() as store:
        lead = store.get_enriched_lead(args.place_id)
        if lead is None:
            row = store.get_lead_row(args.place_id)
            if row is None:
                print(f"No lead found: {args.place_id}", file=sys.stderr)
                return 1
            print(json.dumps(dict(row), indent=2, default=str))
            return 0
        print(json.dumps(lead.model_dump(mode="json"), indent=2, default=str))
    return 0


def cmd_db_run_report(args: argparse.Namespace) -> int:
    with LeadStore() as store:
        report = store.run_report(args.run_id)
        if not report:
            print(f"Run not found: {args.run_id}", file=sys.stderr)
            return 1
        cost = report.get("cost_summary") or store.cost_summary(args.run_id)
        print(json.dumps(report, indent=2, default=str))
        if cost.get("event_count"):
            print(
                f"\nCost summary: {cost['event_count']} event(s), "
                f"${cost['usd_total']:.4f} USD estimated"
            )
    return 0


def cmd_db_archive_stats(_args: argparse.Namespace) -> int:
    settings = get_settings()
    from pallares_leads.db.raw_archive import get_raw_archive

    if not settings.raw_capture_enabled:
        print("Raw capture disabled (raw_capture_enabled=false)", file=sys.stderr)
        return 1
    archive = get_raw_archive(settings)
    stats = archive.stats()
    print(json.dumps(stats, indent=2))
    if stats["by_provider"]:
        print(
            f"\nRaw archive: {stats['total_count']} capture(s), "
            f"{stats['total_blob_bytes']:,} compressed bytes at {stats['path']}"
        )
        for row in stats["by_provider"]:
            print(
                f"  {row['provider']}: {row['count']} capture(s), "
                f"{row['blob_bytes']:,} bytes"
            )
    else:
        print(f"\nRaw archive empty at {stats['path']}")
    return 0


def cmd_db_prune(args: argparse.Namespace) -> int:
    settings = get_settings()
    with LeadStore() as store:
        stats = store.prune_stale_data(
            runs_dir=settings.runs_dir,
            page_cache_ttl_days=settings.page_cache_ttl_days,
            keep_days=args.keep_days,
            dry_run=args.dry_run,
        )
    mode = "would prune" if args.dry_run else "pruned"
    print(
        f"db prune ({mode}): "
        f"{stats['page_cache_deleted']} page_cache row(s), "
        f"{stats['run_dirs_deleted']} run folder(s) "
        f"({stats['run_dirs_skipped']} skipped — recent or leads not in DB)"
    )
    return 0


def cmd_harvest_managers(args: argparse.Namespace) -> int:
    settings = get_settings()

    def _body() -> int:
        if not settings.firecrawl_api_key:
            print("FIRECRAWL_API_KEY is required for harvest-managers", file=sys.stderr)
            return 1

        markets = load_markets(settings.config_dir)
        if args.market not in markets:
            print(f"Unknown market {args.market!r}", file=sys.stderr)
            return 1

        firecrawl = FirecrawlClient(settings)
        with LeadStore() as store:
            count = harvest_management_directory(
                settings=settings,
                market_key=args.market,
                market=markets[args.market],
                store=store,
                firecrawl=firecrawl,
                limit=args.limit,
            )
        print(f"Harvested {count} management profile(s) for {args.market}")
        return 0

    return _run_under_pipeline_lock(settings, _body)

def cmd_expand_portfolio(args: argparse.Namespace) -> int:
    settings = get_settings()

    def _body() -> int:
        if not settings.firecrawl_api_key:
            print("FIRECRAWL_API_KEY is required for expand-portfolio", file=sys.stderr)
            return 1
        markets = load_markets(settings.config_dir)
        if args.market not in markets:
            print(f"Unknown market {args.market!r}", file=sys.stderr)
            return 1
        mgmt_key = args.mgmt_key
        if not mgmt_key.startswith("mgmt:"):
            mgmt_key = f"mgmt:{mgmt_key}"
        firecrawl = FirecrawlClient(settings)
        with LeadStore() as store:
            expansion = expand_portfolio_from_profile(
                settings=settings,
                store=store,
                firecrawl=firecrawl,
                mgmt_key=mgmt_key,
                market_key=args.market,
                limit=args.limit,
            )
        print(
            f"Expanded {mgmt_key}: {len(expansion.properties)} portfolio lot(s) "
            f"({expansion.company_name})"
        )
        return 0

    return _run_under_pipeline_lock(settings, _body)


def cmd_request(args: argparse.Namespace) -> int:
    settings = get_settings()

    if args.status:
        with LeadStore() as store:
            row = store.get_lead_request(args.status)
        if row is None:
            print(f"Request not found: {args.status}", file=sys.stderr)
            return 1
        print(json.dumps(row, indent=2, default=str))
        return 0

    prompt = " ".join(args.prompt).strip()
    spec_data: dict | None = None
    if args.spec_json:
        try:
            spec_data = json.loads(args.spec_json)
        except json.JSONDecodeError as exc:
            print(f"Invalid --spec-json: {exc}", file=sys.stderr)
            return 1
    elif not prompt:
        print(
            'Provide a natural-language request, e.g. request "5 leads in reedley"', file=sys.stderr
        )
        return 1

    with LeadStore() as store:
        if spec_data is not None:
            spec = spec_from_dict(spec_data, settings=settings, prompt=prompt)
            if not prompt:
                prompt = (
                    f"[builder] {spec.count} {spec.target_kind} lead(s) · "
                    f"markets: {', '.join(spec.market_keys) or '(none)'} · "
                    f"categories: {', '.join(spec.categories) or '(none)'}"
                )
        else:
            spec = parse_lead_request(prompt, settings, store=store)
        spec.raw_prompt = prompt
        print("Parsed request:")
        for line in spec.summary_lines():
            print(f"  {line}")

        cost = estimate_request_cost(spec)
        print(
            f"\nCost estimate: ~{cost['total_credits_est']} Firecrawl credits, "
            f"~${cost['usd_est']:.2f} USD equivalent"
        )

        if args.dry_run:
            print("\nDry run — no discovery or research performed.")
            return 0

        if spec.needs_confirmation and not args.yes:
            print("\nConfirmation required (needs_confirmation items present). Re-run with --yes.")
            return 1

        if not args.yes:
            answer = input("\nProceed? [y/N] ").strip().lower()
            if answer not in ("y", "yes"):
                print("Cancelled.")
                return 0

        try:
            with pipeline_lock(settings.data_dir):
                result = fulfill_request(spec, settings, store)
        except PipelineLockedError as exc:
            print(str(exc), file=sys.stderr)
            return 1

    print(
        f"\nRequest {result.request_id}: delivered {len(result.delivered)} lead(s) "
        f"({result.reused_from_db} reused, {result.newly_enriched} newly researched)"
    )
    if result.output_path:
        print(f"Export: {result.output_path}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="pallares-leads", description="PALLARES lead pipeline")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="Run discovery (+ research) for a market")
    run.add_argument("--market", help="Market key from config/markets.yaml")
    run.add_argument("--category", help="Category key from config/categories.yaml")
    run.add_argument("--all-categories", action="store_true")
    run.add_argument("--discover-only", action="store_true", help="Skip Firecrawl research")
    run.add_argument("--dry-run", action="store_true", help="Print queries only")
    run.add_argument("--limit", type=int, help="Max leads to discover per category")
    _add_lead_db_flags(run)
    run.set_defaults(func=cmd_run)

    campaign = sub.add_parser(
        "run-campaign", help="Run the full campaign matrix from config/campaign.yaml"
    )
    campaign.add_argument(
        "--campaign", default=DEFAULT_CAMPAIGN, help="Campaign key (default: central_valley)"
    )
    campaign.add_argument("--market", help="Comma-separated market filter (e.g. reedley,fresno)")
    campaign.add_argument("--category", help="Comma-separated category filter")
    campaign.add_argument("--limit", type=int, help="Max leads per market/category combo")
    campaign.add_argument("--discover-only", action="store_true")
    campaign.add_argument("--dry-run", action="store_true")
    _add_lead_db_flags(campaign)
    campaign.set_defaults(func=cmd_run_campaign)

    smoke = sub.add_parser(
        "smoke-sample",
        help="Small researched sample run (default: Reedley, 5 leads × each campaign category)",
    )
    smoke.add_argument("--campaign", default=DEFAULT_CAMPAIGN)
    smoke.add_argument("--market", help="Market key(s), comma-separated (default: reedley only)")
    smoke.add_argument("--all-markets", action="store_true", help="Run all campaign markets")
    smoke.add_argument(
        "--limit", type=int, default=SMOKE_SAMPLE_LIMIT, help="Leads per category (default: 5)"
    )
    smoke.add_argument("--discover-only", action="store_true")
    smoke.add_argument("--dry-run", action="store_true")
    _add_lead_db_flags(smoke)
    smoke.set_defaults(func=cmd_smoke_sample)

    lst = sub.add_parser("list", help="List configured markets, categories, and campaigns")
    lst.set_defaults(func=cmd_list_config)

    doc = sub.add_parser("doctor", help="Verify API keys and Places API (New) connectivity")
    doc.add_argument(
        "--config",
        action="store_true",
        help="Validate markets, categories, campaigns, and jurisdictions YAML",
    )
    doc.add_argument(
        "--json",
        action="store_true",
        help="Emit a structured JSON health report (preferred by the dashboard)",
    )
    doc.set_defaults(func=cmd_doctor)

    schema = sub.add_parser(
        "settings-schema",
        help="Export Settings JSON schema and masked values for the dashboard",
    )
    schema.set_defaults(func=cmd_settings_schema)

    from pallares_leads.queue_worker import add_worker_parser

    add_worker_parser(sub)

    harvest = sub.add_parser(
        "harvest-managers",
        help="Harvest property-management company profiles into research playbooks",
    )
    harvest.add_argument("--market", required=True, help="Market key from config/markets.yaml")
    harvest.add_argument("--limit", type=int, default=15, help="Max profiles to harvest")
    harvest.set_defaults(func=cmd_harvest_managers)

    expand = sub.add_parser(
        "expand-portfolio",
        help="Fan out a mgmt: profile portfolio into Places-seeded lots with PM phone/clue",
    )
    expand.add_argument("--market", required=True, help="Market key from config/markets.yaml")
    expand.add_argument(
        "--mgmt-key",
        required=True,
        help="Management profile key (mgmt:domain or domain)",
    )
    expand.add_argument("--limit", type=int, default=25, help="Max portfolio lots to seed")
    expand.set_defaults(func=cmd_expand_portfolio)

    req = sub.add_parser(
        "request",
        help='Natural-language lead request, e.g. request "5 leads in reedley along CA-99"',
    )
    req.add_argument("prompt", nargs="*", help="Natural-language request text")
    req.add_argument(
        "--spec-json",
        help=(
            "Structured JSON spec (bypasses natural-language parsing); "
            "fields match LeadRequestSpec"
        ),
    )
    req.add_argument("--dry-run", action="store_true", help="Parse spec and estimate cost only")
    req.add_argument("--yes", action="store_true", help="Skip confirmation prompt")
    req.add_argument("--status", metavar="REQUEST_ID", help="Show status for a past request")
    req.set_defaults(func=cmd_request)

    db = sub.add_parser("db", help="Supabase lead ledger (dedupe + run history)")
    db_sub = db.add_subparsers(dest="db_command", required=True)

    db_status = db_sub.add_parser("status", help="Show lead counts and recent runs")
    db_status.add_argument("--limit", type=int, default=5, help="Recent runs to show")
    db_status.set_defaults(func=cmd_db_status)

    db_import = db_sub.add_parser("import", help="Import leads from existing CSV/JSONL into the DB")
    db_import.add_argument("--csv", help="Single CSV file to import")
    db_import.add_argument("--jsonl", help="Single JSONL file to import")
    db_import.set_defaults(func=cmd_db_import)

    db_profiles = db_sub.add_parser("profiles", help="List learned research profiles")
    db_profiles.add_argument("--limit", type=int, default=30)
    db_profiles.set_defaults(func=cmd_db_profiles)

    db_lead = db_sub.add_parser("lead", help="Show canonical researched record for a place_id")
    db_lead.add_argument("place_id", help="Google place_id")
    db_lead.set_defaults(func=cmd_db_lead)

    db_runs = db_sub.add_parser("report", help="Run report with stage credits and cost summary")
    db_runs.add_argument("run_id", help="Run UUID from db status")
    db_runs.set_defaults(func=cmd_db_run_report)

    db_archive = db_sub.add_parser(
        "archive-stats",
        help="Raw API capture counts and compressed size by provider",
    )
    db_archive.set_defaults(func=cmd_db_archive_stats)

    db_prune = db_sub.add_parser(
        "prune",
        help="Prune expired page_cache rows and stale run artifact folders",
    )
    db_prune.add_argument(
        "--keep-days",
        type=int,
        default=30,
        help="Delete run folders older than N days when all leads are in the DB (default: 30)",
    )
    db_prune.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would be deleted without removing files or rows",
    )
    db_prune.set_defaults(func=cmd_db_prune)

    eval_replay = sub.add_parser(
        "eval-replay",
        help="Replay research from saved raw JSONL with stage-traced eval reports",
    )
    eval_replay.add_argument(
        "--from-jsonl",
        type=Path,
        default=None,
        help="JSONL file or directory (default: data/raw/)",
    )
    eval_replay.add_argument(
        "--batch-size", type=int, default=3, help="Leads per batch (default: 3)"
    )
    eval_replay.add_argument("--limit", type=int, help="Max leads to replay")
    eval_replay.add_argument(
        "--batch-offset",
        type=int,
        default=0,
        help="Skip first N batches (0-based batch index offset)",
    )
    eval_replay.add_argument(
        "--batch-limit",
        type=int,
        help="Run at most N batches (after offset)",
    )
    eval_replay.add_argument(
        "--db-only",
        action="store_true",
        help="Replay only place_ids already researched in the local DB (smoke-sample set)",
    )
    eval_replay.add_argument(
        "--no-learn",
        action="store_true",
        help="Do not update research playbooks during eval replay",
    )
    eval_replay.add_argument(
        "--min-sales-ready-rate",
        type=float,
        metavar="RATIO",
        help="Exit 1 if heuristic sales-ready rate falls below this (0.0-1.0, e.g. 0.9)",
    )
    eval_replay.set_defaults(func=cmd_eval_replay)

    return parser


def cmd_eval_replay(args: argparse.Namespace) -> int:
    from pallares_leads.eval.replay import run_eval_replay

    settings = get_settings()
    source = args.from_jsonl or (settings.raw_dir)

    if not settings.firecrawl_api_key:
        print("FIRECRAWL_API_KEY is required for eval replay", file=sys.stderr)
        return 1

    try:
        eval_dir, summary = run_eval_replay(
            settings,
            from_jsonl=source,
            batch_size=args.batch_size,
            limit=args.limit,
            batch_offset=args.batch_offset,
            batch_limit=args.batch_limit,
            db_only=args.db_only,
            learn_profiles=not args.no_learn,
        )
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    print(f"Eval replay complete: {eval_dir}")
    print(f"  Summary: {eval_dir / 'summary.json'}")
    print(f"  Findings: {eval_dir / 'FINDINGS.md'}")

    min_rate = getattr(args, "min_sales_ready_rate", None)
    if min_rate is not None:
        actual = float(summary.get("heuristic_sales_ready_rate") or 0)
        print(f"  Heuristic sales-ready rate: {actual:.1%} (min {min_rate:.1%})")
        if actual < min_rate:
            print(
                f"Sales-ready rate {actual:.1%} below threshold {min_rate:.1%}",
                file=sys.stderr,
            )
            return 1
    return 0


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    _configure_logging(args.verbose)
    raise SystemExit(args.func(args))


if __name__ == "__main__":
    main()

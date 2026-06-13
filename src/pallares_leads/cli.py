from __future__ import annotations

import argparse
import json
import logging
import sys
from collections.abc import Callable
from pathlib import Path

from pallares_leads.config_loader import load_campaigns, load_categories, load_markets
from pallares_leads.db.store import LeadStore
from pallares_leads.discover.mgmt_directory import harvest_management_directory
from pallares_leads.discover.places import PlacesClient
from pallares_leads.enrich.firecrawl_client import FirecrawlClient
from pallares_leads.pipeline.export_csv import load_enriched_from_csv
from pallares_leads.pipeline.export_sheets import (
    export_sheets,
    sheets_configured,
    sheets_health_check,
)
from pallares_leads.pipeline.run_campaign import DEFAULT_CAMPAIGN, run_campaign
from pallares_leads.pipeline.run_market import run_market_category
from pallares_leads.request.fulfill import fulfill_request
from pallares_leads.request.planner import estimate_request_cost, parse_lead_request, spec_from_dict
from pallares_leads.settings import Settings, get_settings
from pallares_leads.utils.run_lock import PipelineLockedError, pipeline_lock

SMOKE_SAMPLE_LIMIT = 5


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
        help="Process all discovered leads even if already enriched in the DB",
    )
    parser.set_defaults(skip_known=True)
    parser.add_argument(
        "--refresh-after-days",
        type=int,
        metavar="N",
        help="Re-enrich leads last processed more than N days ago",
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
            with LeadStore(settings.db_path) as store:
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
                skip_sheets=args.no_sheets,
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
                skip_sheets=args.no_sheets,
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
    """Run a small fully-enriched sample (default: Reedley, 5 leads per category)."""
    settings = get_settings()

    if not settings.firecrawl_api_key and not args.discover_only:
        print(
            "FIRECRAWL_API_KEY is required for full enrichment. "
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
        f"limit={limit}, enrich={'yes' if not args.discover_only else 'no'}"
    )

    def _body() -> int:
        try:
            summary = run_campaign(
                settings=settings,
                campaign_key=args.campaign,
                limit=limit,
                discover_only=args.discover_only,
                dry_run=args.dry_run,
                skip_sheets=args.no_sheets,
                market_filter=market_filter,
                **_run_db_kwargs(args),
            )
        except ValueError as exc:
            print(str(exc), file=sys.stderr)
            return 1

        _print_campaign_summary(summary)
        if summary.failures:
            return 1

        if not args.no_sheets and sheets_configured(settings):
            print("Google Sheets updated (new rows appended by place_id dedupe).")
        elif not args.no_sheets:
            print("Google Sheets not configured — CSVs written to data/output/ only.")

        return 0

    return _run_under_pipeline_lock(settings, _body)


def cmd_sync_sheets(args: argparse.Namespace) -> int:
    settings = get_settings()

    def _body() -> int:
        if not sheets_configured(settings):
            print(
                "Google Sheets not configured — set GOOGLE_SHEETS_SPREADSHEET_ID "
                "and GOOGLE_SERVICE_ACCOUNT_JSON",
                file=sys.stderr,
            )
            return 1

        if args.place_ids:
            place_ids = {pid.strip() for pid in args.place_ids.split(",") if pid.strip()}
            with LeadStore(settings.db_path) as store:
                leads = store.list_enriched_leads(place_ids=place_ids)
                crm_map = store.get_crm_statuses()
            if not leads:
                print(f"No enriched leads found for place_ids: {args.place_ids}", file=sys.stderr)
                return 1
            print(f"Loaded {len(leads)} enriched lead(s) by place_id")
        elif args.from_db:
            with LeadStore(settings.db_path) as store:
                leads = store.list_enriched_leads()
                crm_map = store.get_crm_statuses()
            if not leads:
                print("No enriched leads in DB — run the pipeline first", file=sys.stderr)
                return 1
            print(f"Loaded {len(leads)} enriched lead(s) from database")
        elif args.all:
            csv_paths = sorted(settings.output_dir.glob("*.csv"))
            if not csv_paths:
                print("No CSV files in data/output/", file=sys.stderr)
                return 1
            seen: set[str] = set()
            leads = []
            for path in csv_paths:
                for lead in load_enriched_from_csv(path):
                    if lead.place_id not in seen:
                        seen.add(lead.place_id)
                        leads.append(lead)
            with LeadStore(settings.db_path) as store:
                crm_map = store.get_crm_statuses()
            print(f"Loaded {len(leads)} unique leads from {len(csv_paths)} CSV file(s)")
        else:
            csv_path = Path(args.csv) if args.csv else None
            if csv_path is None:
                candidates = sorted(
                    settings.output_dir.glob("*.csv"),
                    key=lambda p: p.stat().st_mtime,
                    reverse=True,
                )
                if not candidates:
                    print(
                        "No CSV files in data/output — run the pipeline first or pass --csv",
                        file=sys.stderr,
                    )
                    return 1
                csv_path = candidates[0]
                print(f"Using latest CSV: {csv_path.name}")

            if not csv_path.is_file():
                print(f"CSV not found: {csv_path}", file=sys.stderr)
                return 1

            leads = load_enriched_from_csv(csv_path)
            with LeadStore(settings.db_path) as store:
                crm_map = store.get_crm_statuses()

        added = export_sheets(leads, settings, rewrite=args.rewrite, crm_status_map=crm_map)
        label = "all CSVs" if args.all else (args.csv or "latest CSV")
        print(f"Google Sheets: wrote {added} lead(s) from {label}")
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
        from pallares_leads.enrich.firecrawl_client import FirecrawlClient

        fc = FirecrawlClient(settings)
        fc_ok, fc_msg = fc.health_check()
        status = "OK" if fc_ok else "FAIL"
        print(f"Firecrawl: {status} — {fc_msg}")
        ok = ok and fc_ok
        if settings.firecrawl_max_credits_per_run > 0:
            print(f"  Run credit cap: {settings.firecrawl_max_credits_per_run} credits/run")

    if sheets_configured(settings):
        sheets_ok, sheets_msg = sheets_health_check(settings)
        status = "OK" if sheets_ok else "WARN"
        print(f"Google Sheets: {status} — {sheets_msg}")
        if not sheets_ok:
            print("  (optional — exports skip until service account JSON is present)")
    elif settings.google_sheets_spreadsheet_id or settings.google_service_account_json:
        print(
            "Google Sheets: INCOMPLETE — set both GOOGLE_SHEETS_SPREADSHEET_ID "
            "and GOOGLE_SERVICE_ACCOUNT_JSON (optional for pipeline runs)"
        )
    else:
        print("Google Sheets: not configured (optional — auto-syncs when .env is set)")

    if not settings.ai_gateway_enabled:
        print("AI Gateway: disabled (AI_GATEWAY_ENABLED=false)")
    elif not settings.ai_gateway_api_key:
        print("AI Gateway: MISSING — set AI_GATEWAY_API_KEY in .env (sales copy)")
    elif not settings.ai_gateway_model:
        print("AI Gateway: INCOMPLETE — set AI_GATEWAY_MODEL in .env")
    else:
        print(
            f"AI Gateway: OK — model {settings.ai_gateway_model} "
            "(token costs tracked per completion)"
        )

    with LeadStore(settings.db_path) as store:
        lead_count = store.count_leads()
        enriched_count = store.count_enriched()
        repaired = store.repair_stuck_runs()
        if repaired:
            print(f"  Repaired {repaired} stuck run(s) marked as failed")
        print(f"Lead DB: {store.db_path} — {lead_count} lead(s), {enriched_count} enriched")

        if settings.firecrawl_api_key:
            from pallares_leads.enrich.firecrawl_client import FirecrawlClient

            fc_balance = FirecrawlClient(settings, store=store).get_team_credit_usage()
            remaining = fc_balance.get("remainingCredits", fc_balance.get("remaining_credits"))
            plan = fc_balance.get("planCredits", fc_balance.get("plan_credits"))
            if remaining is not None:
                detail = f"{float(remaining):.0f} credits remaining"
                if plan is not None:
                    detail += f" of {float(plan):.0f} plan credits"
                print(f"  Firecrawl balance snapshot: {detail}")
            elif fc_balance.get("error"):
                print(f"  Firecrawl balance snapshot: unavailable ({fc_balance['error'][:80]})")

        if settings.browser_use_api_key:
            from pallares_leads.enrich.browser_use_client import BrowserUseClient

            bu = BrowserUseClient(settings, store=store)
            if not settings.browser_use_enabled:
                print("Browser Use: configured but disabled (BROWSER_USE_ENABLED=false)")
            else:
                bu_ok, bu_msg = bu.health_check()
                status = "OK" if bu_ok else "FAIL"
                print(f"Browser Use: {status} — {bu_msg}")
                ok = ok and bu_ok
                if settings.owner_chain_max_per_run > 0:
                    print(f"  Owner-chain cap: {settings.owner_chain_max_per_run} lookups/run")
        elif settings.browser_use_enabled:
            print("Browser Use: MISSING — set BROWSER_USE_API_KEY in .env (owner-chain lookups)")
            ok = False

    return 0 if ok else 1


def cmd_warm_portals(args: argparse.Namespace) -> int:
    """Seed Browser Use Cloud cached scripts for county/state portal adapters."""
    settings = get_settings()
    from pallares_leads.config_loader import load_jurisdictions
    from pallares_leads.enrich.browser_use_client import BrowserUseClient

    if args.dry_run:
        print("warm-portals dry-run: would warm CA SOS and county recorder/parcel adapters")
        return 0

    if not settings.browser_use_api_key:
        print("BROWSER_USE_API_KEY is required for warm-portals", file=sys.stderr)
        return 1

    registry = load_jurisdictions(settings.config_dir)
    county_filter = args.county
    counties = registry.counties
    if county_filter:
        if county_filter not in counties:
            print(
                f"Unknown county {county_filter!r}. Options: {', '.join(sorted(counties))}",
                file=sys.stderr,
            )
            return 1
        counties = {county_filter: counties[county_filter]}

    with LeadStore(settings.db_path) as store:
        client = BrowserUseClient(settings, store=store)
        if not client.is_available():
            print(client.last_skip_reason or "Browser Use unavailable", file=sys.stderr)
            return 1

        ca_state = registry.states.get("ca")
        warmed = 0
        if ca_state:
            print("Warming CA SOS bizfile template...")
            client.sos_entity_lookup("CALIFORNIA TEST LLC", ca_state)
            warmed += 1

        for key, county in counties.items():
            print(f"Warming county adapters for {key}...")
            if county.recorder:
                client.recorder_party_search("TEST PROPERTY LLC", county)
                warmed += 1
            if county.parcel_portal and county.parcel_portal.owner_names_online is not False:
                city = "Visalia" if key == "tulare_ca" else "Fresno"
                client.parcel_owner_lookup("100 Main St", city, county)
                warmed += 1

        print(f"warm-portals complete — {warmed} adapter task(s) submitted")
    return 0


def cmd_db_status(args: argparse.Namespace) -> int:
    settings = get_settings()
    with LeadStore(settings.db_path) as store:
        print(f"Database: {store.db_path}")
        print(f"  Total leads:    {store.count_leads()}")
        print(f"  Enriched:       {store.count_enriched()}")
        runs = store.recent_runs(limit=args.limit)
        if runs:
            print(f"\nRecent runs (last {len(runs)}):")
            for run in runs:
                label = run["run_type"]
                if run["market_key"]:
                    label += f" {run['market_key']}/{run['category_key']}"
                print(
                    f"  {run['started_at'][:19]}  {label}  "
                    f"discovered={run['discovered_count']}  "
                    f"skipped={run['skipped_known_count']}  "
                    f"enriched={run['enriched_count']}  "
                    f"{run['status']}"
                )
        else:
            print("\nNo runs recorded yet.")
            if store.count_leads() == 0:
                print("Import existing CSV/JSONL: pallares-leads db import")
    return 0


def cmd_db_import(args: argparse.Namespace) -> int:
    settings = get_settings()
    with LeadStore(settings.db_path) as store:
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
    settings = get_settings()
    with LeadStore(settings.db_path) as store:
        profiles = store.list_profiles(limit=args.limit)
        print(f"Enrichment profiles: {store.count_profiles()} total\n")
        for row in profiles:
            playbook = row.get("playbook") or {}
            print(
                f"  {row['profile_key']}  successes={row['success_count']}  "
                f"tier={playbook.get('winning_tier', '—')}  "
                f"skip_firecrawl={playbook.get('skip_firecrawl', False)}"
            )
    return 0


def cmd_db_lead(args: argparse.Namespace) -> int:
    settings = get_settings()
    with LeadStore(settings.db_path) as store:
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
    settings = get_settings()
    with LeadStore(settings.db_path) as store:
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


def cmd_db_prune(args: argparse.Namespace) -> int:
    settings = get_settings()
    with LeadStore(settings.db_path) as store:
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
        with LeadStore(settings.db_path) as store:
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


def cmd_request(args: argparse.Namespace) -> int:
    settings = get_settings()

    if args.status:
        with LeadStore(settings.db_path) as store:
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

    with LeadStore(settings.db_path) as store:
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
            f"~${cost['usd_est']:.2f} USD"
        )

        if args.dry_run:
            print("\nDry run — no discovery or enrichment performed.")
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
        f"({result.reused_from_db} reused, {result.newly_enriched} newly enriched)"
    )
    if result.output_path:
        print(f"Export: {result.output_path}")
    return 0


def cmd_db_import_feedback(_args: argparse.Namespace) -> int:
    settings = get_settings()
    from pallares_leads.pipeline.export_sheets import import_feedback_from_sheets

    try:
        rows = import_feedback_from_sheets(settings)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    with LeadStore(settings.db_path) as store:
        for row in rows:
            addressed = bool(row.get("addressed"))
            status = row.get("status") or ""
            store.upsert_sales_feedback(
                row["place_id"],
                addressed=addressed,
                feedback_notes=row.get("notes") or "",
                status=status or None,
                sales_ready=True if status == "Ready to call" else None,
            )
        print(
            f"Imported feedback for {len(rows)} row(s) — total {store.count_sales_feedback()} in DB"
        )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="pallares-leads", description="PALLARES lead pipeline")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="Run discovery (+ enrichment) for a market")
    run.add_argument("--market", help="Market key from config/markets.yaml")
    run.add_argument("--category", help="Category key from config/categories.yaml")
    run.add_argument("--all-categories", action="store_true")
    run.add_argument("--discover-only", action="store_true", help="Skip Firecrawl enrichment")
    run.add_argument("--dry-run", action="store_true", help="Print queries only")
    run.add_argument("--no-sheets", action="store_true", help="Skip Google Sheets export")
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
    campaign.add_argument("--no-sheets", action="store_true")
    _add_lead_db_flags(campaign)
    campaign.set_defaults(func=cmd_run_campaign)

    smoke = sub.add_parser(
        "smoke-sample",
        help="Small enriched sample run (default: Reedley, 5 leads × each campaign category)",
    )
    smoke.add_argument("--campaign", default=DEFAULT_CAMPAIGN)
    smoke.add_argument("--market", help="Market key(s), comma-separated (default: reedley only)")
    smoke.add_argument("--all-markets", action="store_true", help="Run all campaign markets")
    smoke.add_argument(
        "--limit", type=int, default=SMOKE_SAMPLE_LIMIT, help="Leads per category (default: 5)"
    )
    smoke.add_argument("--discover-only", action="store_true")
    smoke.add_argument("--dry-run", action="store_true")
    smoke.add_argument("--no-sheets", action="store_true")
    _add_lead_db_flags(smoke)
    smoke.set_defaults(func=cmd_smoke_sample)

    lst = sub.add_parser("list", help="List configured markets, categories, and campaigns")
    lst.set_defaults(func=cmd_list_config)

    doc = sub.add_parser("doctor", help="Verify API keys and Places API (New) connectivity")
    doc.set_defaults(func=cmd_doctor)

    warm = sub.add_parser(
        "warm-portals",
        help="Seed Browser Use Cloud cached portal scripts (one-time setup)",
    )
    warm.add_argument(
        "--county",
        help="County jurisdiction key (default: all counties in jurisdictions.yaml)",
    )
    warm.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned warm-up steps without calling Browser Use",
    )
    warm.set_defaults(func=cmd_warm_portals)

    sync = sub.add_parser("sync-sheets", help="Push leads from a CSV file to Google Sheets")
    sync.add_argument("--csv", help="CSV path (default: newest file in data/output/)")
    sync.add_argument(
        "--all",
        action="store_true",
        help="Load all CSVs from data/output/ (deduped by place_id)",
    )
    sync.add_argument(
        "--from-db",
        action="store_true",
        help="Load canonical enriched_json from SQLite instead of CSV",
    )
    sync.add_argument(
        "--rewrite",
        action="store_true",
        help="Clear existing data rows and rewrite from CSV",
    )
    sync.add_argument(
        "--place-ids",
        help="Comma-separated place_ids to export from DB (--from-db implied)",
    )
    sync.set_defaults(func=cmd_sync_sheets)

    harvest = sub.add_parser(
        "harvest-managers",
        help="Harvest property-management company profiles into enrichment_profiles",
    )
    harvest.add_argument("--market", required=True, help="Market key from config/markets.yaml")
    harvest.add_argument("--limit", type=int, default=15, help="Max profiles to harvest")
    harvest.set_defaults(func=cmd_harvest_managers)

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

    db = sub.add_parser("db", help="Local SQLite lead ledger (dedupe + run history)")
    db_sub = db.add_subparsers(dest="db_command", required=True)

    db_status = db_sub.add_parser("status", help="Show lead counts and recent runs")
    db_status.add_argument("--limit", type=int, default=5, help="Recent runs to show")
    db_status.set_defaults(func=cmd_db_status)

    db_import = db_sub.add_parser("import", help="Import leads from existing CSV/JSONL into the DB")
    db_import.add_argument("--csv", help="Single CSV file to import")
    db_import.add_argument("--jsonl", help="Single JSONL file to import")
    db_import.set_defaults(func=cmd_db_import)

    db_profiles = db_sub.add_parser("profiles", help="List learned enrichment profiles")
    db_profiles.add_argument("--limit", type=int, default=30)
    db_profiles.set_defaults(func=cmd_db_profiles)

    db_lead = db_sub.add_parser("lead", help="Show canonical enriched record for a place_id")
    db_lead.add_argument("place_id", help="Google place_id")
    db_lead.set_defaults(func=cmd_db_lead)

    db_runs = db_sub.add_parser("report", help="Run report with stage credits and cost summary")
    db_runs.add_argument("run_id", help="Run UUID from db status")
    db_runs.set_defaults(func=cmd_db_run_report)

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

    db_feedback = db_sub.add_parser(
        "import-feedback",
        help="Import Addressed + Notes from Google Sheets into sales_feedback table",
    )
    db_feedback.set_defaults(func=cmd_db_import_feedback)

    eval_replay = sub.add_parser(
        "eval-replay",
        help="Replay enrichment from saved raw JSONL with stage-traced eval reports",
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
        help="Replay only place_ids already enriched in the local DB (smoke-sample set)",
    )
    eval_replay.add_argument(
        "--sync-sheets",
        action="store_true",
        help="Append all replayed leads to Google Sheets once at end (default: skip Sheets)",
    )
    eval_replay.add_argument(
        "--no-learn",
        action="store_true",
        help="Do not update enrichment playbooks during eval replay",
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
            skip_sheets=not args.sync_sheets,
            sync_sheets=args.sync_sheets,
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

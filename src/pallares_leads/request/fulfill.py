from __future__ import annotations

import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import httpx

from pallares_leads.config_loader import CategoryConfig, MarketConfig, load_categories, load_markets
from pallares_leads.db.store import LeadStore
from pallares_leads.discover.places import PlacesClient
from pallares_leads.enrich.contact_requirements import get_enrichment_rules, is_callable_phone
from pallares_leads.enrich.firecrawl_client import FirecrawlClient
from pallares_leads.pipeline.dedupe import dedupe_leads
from pallares_leads.pipeline.export_csv import export_csv
from pallares_leads.pipeline.run_market import enrich_lead
from pallares_leads.progress import bind_progress
from pallares_leads.progress import emit as progress_emit
from pallares_leads.request.spec import LeadRequestSpec
from pallares_leads.resolve.lead_score import compute_lead_score, is_decision_maker_contact
from pallares_leads.schemas import EnrichedLead, RawLead
from pallares_leads.settings import Settings
from pallares_leads.utils.errors import failure_fields
from pallares_leads.utils.geo import within_corridor_buffer
from pallares_leads.utils.snapshots import append_jsonl

logger = logging.getLogger(__name__)

OVERPASS_ROAD_URL = "https://overpass-api.de/api/interpreter"


@dataclass
class RequestResult:
    request_id: str
    delivered: list[EnrichedLead] = field(default_factory=list)
    reused_from_db: int = 0
    newly_enriched: int = 0
    credits_spent: int = 0
    output_path: Path | None = None
    status: str = "completed"


def _geo_cache_path(settings: Settings, road_ref: str, market_key: str) -> Path:
    cache_dir = settings.data_dir / "exports" / "geo_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    safe_ref = road_ref.replace("/", "_").replace(" ", "_")
    return cache_dir / f"{market_key}_{safe_ref}.json"


def fetch_road_polyline(
    road_ref: str,
    market: MarketConfig,
    *,
    settings: Settings,
    market_key: str,
) -> list[tuple[float, float]]:
    """Load or fetch a road centerline polyline for corridor filtering."""
    cache_path = _geo_cache_path(settings, road_ref, market_key)
    if cache_path.is_file():
        data = json.loads(cache_path.read_text(encoding="utf-8"))
        coords = data.get("coords") or []
        return [(float(c[0]), float(c[1])) for c in coords]

    lat = float(market["latitude"])
    lon = float(market["longitude"])
    radius = float(market.get("search_radius_m") or 15_000)
    from pallares_leads.utils.geo import market_bbox

    south, west, north, east = market_bbox(lat, lon, radius)
    query = f"""
[out:json][timeout:45];
way["highway"]["ref"~"{road_ref}",i]({south},{west},{north},{east});
out geom;
""".strip()

    coords: list[tuple[float, float]] = []
    try:
        with httpx.Client(timeout=60.0) as client:
            response = client.post(OVERPASS_ROAD_URL, data={"data": query})
            response.raise_for_status()
            payload = response.json()
        for element in payload.get("elements") or []:
            geometry = element.get("geometry") or []
            for point in geometry:
                coords.append((float(point["lat"]), float(point["lon"])))
    except httpx.HTTPError as exc:
        logger.warning("Road polyline fetch failed for %s: %s", road_ref, exc)
        return []

    if coords:
        cache_path.write_text(
            json.dumps({"road_ref": road_ref, "coords": coords}, ensure_ascii=False),
            encoding="utf-8",
        )
    return coords


def _lead_matches_spec(
    lead: EnrichedLead,
    spec: LeadRequestSpec,
    *,
    corridor_polyline: list[tuple[float, float]] | None,
    config_dir: Path,
) -> bool:
    score = lead.lead_score if lead.lead_score is not None else compute_lead_score(lead)
    if score < spec.min_lead_score:
        return False
    if spec.require_decision_maker and not is_decision_maker_contact(lead):
        return False
    if spec.require_decision_maker and lead.sales_status() != "Ready to call":
        return False
    if spec.recurring_only:
        rules = get_enrichment_rules(lead.property_type, config_dir)
        if not rules.suggest_recurring:
            return False
    if corridor_polyline and not within_corridor_buffer(
        lead.latitude,
        lead.longitude,
        corridor_polyline,
        spec.corridor.buffer_m if spec.corridor else 800,
    ):
        return False
    return True


def _raw_passes_enrich_gate(
    raw: RawLead,
    spec: LeadRequestSpec,
    *,
    corridor_polyline: list[tuple[float, float]] | None,
) -> bool:
    """Cheap pre-enrichment filter so full Firecrawl is not spent on obvious misses."""
    if corridor_polyline and not within_corridor_buffer(
        raw.latitude,
        raw.longitude,
        corridor_polyline,
        spec.corridor.buffer_m if spec.corridor else 800,
    ):
        return False
    if spec.require_decision_maker and not is_callable_phone(raw.main_phone) and not raw.website:
        return False
    if spec.min_lead_score >= 40 and not raw.website and not is_callable_phone(raw.main_phone):
        return False
    return True


def _discover_batch(
    *,
    settings: Settings,
    market_key: str,
    market: MarketConfig,
    category_key: str,
    category: CategoryConfig,
    batch_size: int,
    store: LeadStore,
    run_id: str,
) -> list[RawLead]:
    places = PlacesClient(settings, store=store, run_id=run_id)
    discovered = places.discover_category(
        market_key=market_key,
        market=market,
        category=category,
        limit=batch_size,
    )
    discovered, _ = dedupe_leads(discovered)
    return discovered[:batch_size]


def _fulfill_discovery_loop(
    spec: LeadRequestSpec,
    settings: Settings,
    store: LeadStore,
    *,
    markets: dict[str, MarketConfig],
    categories: dict[str, CategoryConfig],
    corridor_lines: dict[str, list[tuple[float, float]]],
    firecrawl: FirecrawlClient | None,
    run_id: str,
    request_id: str,
    delivered: list[EnrichedLead],
    counters: dict[str, int],
) -> None:
    """Discover and enrich new leads until spec.count or the credit budget is hit."""
    for market_key in spec.market_keys:
        if len(delivered) >= spec.count:
            break
        market = markets.get(market_key)
        if not market:
            continue
        polyline = corridor_lines.get(market_key)

        for category_key in spec.categories:
            if len(delivered) >= spec.count:
                break
            category = categories.get(category_key)
            if not category:
                continue

            batch = _discover_batch(
                settings=settings,
                market_key=market_key,
                market=market,
                category_key=category_key,
                category=category,
                batch_size=min(10, spec.count * 2),
                store=store,
                run_id=run_id,
            )
            if spec.corridor and polyline:
                batch = [
                    raw
                    for raw in batch
                    if within_corridor_buffer(
                        raw.latitude,
                        raw.longitude,
                        polyline,
                        spec.corridor.buffer_m,
                    )
                ]

            raw_to_process, _ = store.filter_new_leads(
                batch,
                skip_known=True,
                force_refresh=False,
                refresh_after_days=None,
            )

            for raw in raw_to_process:
                if len(delivered) >= spec.count:
                    break
                if store.run_credits_total(run_id) >= spec.budget.max_firecrawl_credits:
                    logger.warning("Request credit budget reached")
                    break

                raw_filename = (
                    f"request_{request_id}_{market_key}_{category_key}_"
                    f"{date.today().isoformat()}.jsonl"
                )
                raw_path = settings.raw_dir / raw_filename
                append_jsonl(raw_path, raw.model_dump(mode="json"))

                if not _raw_passes_enrich_gate(
                    raw, spec, corridor_polyline=polyline or None
                ):
                    continue

                if firecrawl:
                    enriched = enrich_lead(raw, firecrawl, settings, store=store, run_id=run_id)
                else:
                    enriched = EnrichedLead.model_validate(raw.model_dump())

                enriched.lead_score = compute_lead_score(enriched)
                store.upsert_enriched(
                    enriched,
                    market_key=market_key,
                    category_key=category_key,
                    run_id=run_id,
                    lead_score=enriched.lead_score,
                    request_id=request_id,
                )
                store.commit_cost_events()

                if _lead_matches_spec(
                    enriched,
                    spec,
                    corridor_polyline=polyline or None,
                    config_dir=settings.config_dir,
                ):
                    delivered.append(enriched)
                    store.link_request_lead(
                        request_id,
                        enriched.place_id,
                        enriched.lead_score or 0,
                        len(delivered),
                    )
                    counters["newly_enriched"] += 1


def fulfill_request(
    spec: LeadRequestSpec,
    settings: Settings,
    store: LeadStore,
    *,
    dry_run: bool = False,
) -> RequestResult:
    """Deterministic DB-first fulfillment loop for a parsed lead request."""
    request_id = str(uuid.uuid4())
    if dry_run:
        return RequestResult(request_id=request_id, status="dry_run")

    store.create_lead_request(request_id, raw_prompt=spec.raw_prompt, spec=spec)
    markets = load_markets(settings.config_dir)
    categories = load_categories(settings.config_dir)

    delivered: list[EnrichedLead] = []
    reused = 0

    corridor_lines: dict[str, list[tuple[float, float]]] = {}
    if spec.corridor:
        for market_key in spec.market_keys:
            market = markets.get(market_key)
            if market:
                corridor_lines[market_key] = fetch_road_polyline(
                    spec.corridor.road_ref,
                    market,
                    settings=settings,
                    market_key=market_key,
                )

    db_candidates = store.query_leads_for_request(
        categories=spec.categories,
        market_keys=spec.market_keys,
        min_lead_score=spec.min_lead_score,
    )
    for row in db_candidates:
        if len(delivered) >= spec.count:
            break
        lead = store.get_enriched_lead(row["place_id"])
        if lead is None:
            continue
        if lead.lead_score is None:
            lead.lead_score = compute_lead_score(lead)
        polyline = corridor_lines.get(row.get("market_key") or "")
        if _lead_matches_spec(
            lead, spec, corridor_polyline=polyline or None, config_dir=settings.config_dir
        ):
            delivered.append(lead)
            store.link_request_lead(request_id, lead.place_id, lead.lead_score or 0, len(delivered))
            reused += 1

    firecrawl: FirecrawlClient | None = None
    if settings.firecrawl_api_key and len(delivered) < spec.count:
        firecrawl = FirecrawlClient(settings, store=store)

    run_id = store.start_run(
        run_type="request",
        campaign_key=request_id,
        request_id=request_id,
    )
    counters = {"newly_enriched": 0}
    run_started_at = time.perf_counter()
    bind_progress(store, run_id=run_id)
    progress_emit(
        "run_started",
        run_id=run_id,
        request_id=request_id,
        count=spec.count,
    )

    try:
        _fulfill_discovery_loop(
            spec,
            settings,
            store,
            markets=markets,
            categories=categories,
            corridor_lines=corridor_lines,
            firecrawl=firecrawl,
            run_id=run_id,
            request_id=request_id,
            delivered=delivered,
            counters=counters,
        )
    except BaseException as exc:
        fail = failure_fields(exc)
        logger.exception(
            "Lead request failed %s — %s",
            request_id,
            fail["stop_detail"],
        )
        duration_ms = int((time.perf_counter() - run_started_at) * 1000)
        try:
            snap = store.run_progress_snapshot(run_id)
            discovered = max(snap["discovered_count"], len(delivered))
            enriched = max(snap["enriched_count"], counters["newly_enriched"])
            progress_emit(
                "run_failed",
                run_id=run_id,
                request_id=request_id,
                status="failed",
                reason=fail["stop_detail"],
                enriched=enriched,
                discovered=discovered,
                duration_ms=duration_ms,
            )
            store.finish_run(
                run_id,
                discovered_count=discovered,
                skipped_known_count=max(snap["skipped_known_count"], reused),
                enriched_count=enriched,
                status="failed",
                stop_reason=fail["stop_reason"],
                stop_detail=fail["stop_detail"],
                error=fail["error"],
                duration_ms=duration_ms,
                request_id=request_id,
            )
            store.finish_lead_request(
                request_id,
                status="failed",
                leads_delivered=len(delivered),
                credits_spent=store.run_credits_total(run_id),
                output_path=None,
            )
        except Exception:
            logger.exception(
                "Failed to persist request failure state for %s / run %s",
                request_id,
                run_id,
            )
        raise
    newly_enriched = counters["newly_enriched"]
    credits_spent = store.run_credits_total(run_id)
    duration_ms = int((time.perf_counter() - run_started_at) * 1000)
    progress_emit(
        "run_done",
        run_id=run_id,
        status="completed",
        discovered=newly_enriched,
        skipped_known=reused,
        enriched=newly_enriched,
        duration_ms=duration_ms,
    )

    store.finish_run(
        run_id,
        discovered_count=newly_enriched,
        skipped_known_count=reused,
        enriched_count=newly_enriched,
        duration_ms=duration_ms,
        request_id=request_id,
    )

    exports_dir = settings.data_dir / "exports"
    exports_dir.mkdir(parents=True, exist_ok=True)
    output_path = exports_dir / f"request_{request_id}.csv"
    if delivered:
        export_csv(delivered, output_path)

    store.finish_lead_request(
        request_id,
        status="completed",
        leads_delivered=len(delivered),
        credits_spent=credits_spent,
        output_path=str(output_path) if delivered else None,
    )

    return RequestResult(
        request_id=request_id,
        delivered=delivered,
        reused_from_db=reused,
        newly_enriched=newly_enriched,
        credits_spent=credits_spent,
        output_path=output_path if delivered else None,
        status="completed",
    )

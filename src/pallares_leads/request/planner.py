from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING, Any

from pallares_leads.config_loader import load_categories, load_markets
from pallares_leads.costs import firecrawl_credit_usd, infer_firecrawl_plan, load_pricing
from pallares_leads.request.spec import BudgetCap, CorridorFilter, LeadRequestSpec
from pallares_leads.settings import Settings

if TYPE_CHECKING:
    from pallares_leads.db.store import LeadStore

logger = logging.getLogger(__name__)


def _default_firecrawl_credit_cap(settings: Settings) -> int:
    env_cap = os.environ.get("PALLARES_REQUEST_MAX_FIRECRAWL_CREDITS")
    if env_cap:
        try:
            cap = int(float(env_cap))
            if cap > 0:
                return cap
        except ValueError:
            pass

    pricing = load_pricing(settings.config_dir)
    _, plan = infer_firecrawl_plan(pricing)
    if plan:
        try:
            cap = int(plan.get("monthly_credits") or 0)
            if cap > 0:
                return cap
        except (TypeError, ValueError):
            pass
    return BudgetCap().max_firecrawl_credits


def _fallback_spec(prompt: str, settings: Settings) -> LeadRequestSpec:
    """Heuristic NL parser (dashboard builder uses structured spec_from_dict)."""
    text = prompt.lower()
    markets = load_markets(settings.config_dir)
    categories = load_categories(settings.config_dir)

    market_keys: list[str] = []
    for key, cfg in markets.items():
        if cfg["city"].lower() in text or key in text:
            market_keys.append(key)
    if not market_keys:
        market_keys = ["reedley"]

    cat_keys: list[str] = []
    synonym_map = {
        "strip mall": "strip_mall",
        "shopping center": "shopping_center",
        "parking": "parking_small",
        "hotel": "hotel",
        "thrift": "thrift_store",
        "public works": "public_agency",
        "gas station": "gas_station",
    }
    for phrase, cat in synonym_map.items():
        if phrase in text and cat in categories:
            cat_keys.append(cat)
    if not cat_keys:
        cat_keys = ["strip_mall"] if "strip_mall" in categories else list(categories)[:1]

    count = 5
    for token in text.split():
        if token.isdigit():
            count = max(1, min(500, int(token)))
            break

    corridor: CorridorFilter | None = None
    if "99" in text or "ca-99" in text:
        corridor = CorridorFilter(road_ref="CA-99", buffer_m=800)

    return LeadRequestSpec(
        count=count,
        categories=cat_keys,
        market_keys=market_keys,
        corridor=corridor,
        require_decision_maker=True,
        recurring_only=False,
        min_lead_score=40,
        budget=BudgetCap(max_firecrawl_credits=_default_firecrawl_credit_cap(settings)),
        needs_confirmation=["Heuristic parse — review spec before running"],
        raw_prompt=prompt,
    )


def _dict_to_spec(data: dict[str, Any], *, prompt: str, settings: Settings) -> LeadRequestSpec:
    markets = load_markets(settings.config_dir)
    categories = load_categories(settings.config_dir)

    market_keys = [k for k in data.get("market_keys") or [] if k in markets]
    cat_keys = [k for k in data.get("categories") or [] if k in categories]
    needs = list(data.get("needs_confirmation") or [])

    for key in data.get("market_keys") or []:
        if key not in markets:
            needs.append(f"market {key!r} not configured")
    for key in data.get("categories") or []:
        if key not in categories:
            needs.append(f"category {key!r} not configured")

    corridor_data = data.get("corridor")
    corridor: CorridorFilter | None = None
    if isinstance(corridor_data, dict) and corridor_data.get("road_ref"):
        corridor = CorridorFilter(
            road_ref=str(corridor_data["road_ref"]),
            buffer_m=int(corridor_data.get("buffer_m") or 800),
        )

    budget = BudgetCap(max_firecrawl_credits=_default_firecrawl_credit_cap(settings))

    return LeadRequestSpec(
        target_kind=data.get("target_kind") or "property",
        count=max(1, int(data.get("count") or 1)),
        categories=cat_keys,
        market_keys=market_keys,
        corridor=corridor,
        require_decision_maker=bool(data.get("require_decision_maker", True)),
        recurring_only=bool(data.get("recurring_only", False)),
        min_lead_score=int(data.get("min_lead_score") or 40),
        budget=budget,
        needs_confirmation=needs,
        raw_prompt=prompt,
    )


def spec_from_dict(
    data: dict[str, Any],
    *,
    settings: Settings,
    prompt: str = "",
) -> LeadRequestSpec:
    """Build a validated spec from structured input (e.g. the dashboard builder)."""
    return _dict_to_spec(data, prompt=prompt, settings=settings)


def parse_lead_request(
    prompt: str,
    settings: Settings,
    *,
    store: LeadStore | None = None,
    request_id: str | None = None,
) -> LeadRequestSpec:
    """Parse a natural-language lead request into a typed spec (heuristic)."""
    del store, request_id  # reserved for future persistence / tracing
    logger.info("Parsing lead request with heuristic planner")
    return _fallback_spec(prompt, settings)


def estimate_request_cost(spec: LeadRequestSpec) -> dict[str, float | int]:
    """Rough cost estimate for dry-run display."""
    # map 1 + scrape_json 5 + bbb 3 + search contingency 4 ≈ 13 credits/lead
    per_lead_credits = 13
    discovery_credits = len(spec.categories) * len(spec.market_keys) * 2
    enrich_credits = spec.count * per_lead_credits
    total_credits = discovery_credits + enrich_credits
    usd = total_credits * firecrawl_credit_usd(load_pricing())
    return {
        "discovery_credits_est": discovery_credits,
        "enrich_credits_est": enrich_credits,
        "total_credits_est": total_credits,
        "usd_est": usd,
    }

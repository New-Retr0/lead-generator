from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

from pallares_leads.config_loader import load_categories, load_markets
from pallares_leads.enrich.ai_gateway_client import gateway_chat_completion, gateway_configured
from pallares_leads.enrich.sales_copy import parse_json_from_llm
from pallares_leads.request.spec import BudgetCap, CorridorFilter, LeadRequestSpec
from pallares_leads.settings import Settings

if TYPE_CHECKING:
    from pallares_leads.db.store import LeadStore

logger = logging.getLogger(__name__)

PROMPT_VERSION = "lead_request_v1"

SYSTEM_PROMPT = """You parse natural-language lead requests for a commercial exterior-cleaning
lead pipeline in California's Central Valley.

Map user synonyms to configured category keys (examples):
- strip mall, retail plaza, shops -> strip_mall
- shopping center -> shopping_center
- parking lot, parking -> parking_small or parking_large_private
- hotel, motel -> hotel
- thrift, goodwill, habitat restore -> thrift_store
- community center, shelter -> community_facility
- amusement, entertainment venue -> amusement_facility
- city, public works, municipal -> public_agency

Map city names to configured market keys (lowercase slug): reedley, dinuba, selma,
kingsburg, sanger, fresno, visalia.

If a market or category cannot be mapped, add a human-readable note to needs_confirmation.

Return JSON only with these fields:
- target_kind: "property" or "vendor"
- count: positive integer
- categories: list of category key strings
- market_keys: list of market key strings
- corridor: null or {road_ref, buffer_m}
- require_decision_maker: boolean
- recurring_only: boolean
- min_lead_score: integer 0-100
- budget: {max_firecrawl_credits, max_usd}
- needs_confirmation: list of strings
"""


def _spec_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "target_kind": {"type": "string", "enum": ["property", "vendor"]},
            "count": {"type": "integer", "minimum": 1, "maximum": 500},
            "categories": {"type": "array", "items": {"type": "string"}},
            "market_keys": {"type": "array", "items": {"type": "string"}},
            "corridor": {
                "anyOf": [
                    {"type": "null"},
                    {
                        "type": "object",
                        "properties": {
                            "road_ref": {"type": "string"},
                            "buffer_m": {"type": "integer"},
                        },
                        "required": ["road_ref"],
                    },
                ],
            },
            "require_decision_maker": {"type": "boolean"},
            "recurring_only": {"type": "boolean"},
            "min_lead_score": {"type": "integer", "minimum": 0, "maximum": 100},
            "budget": {
                "type": "object",
                "properties": {
                    "max_firecrawl_credits": {"type": "integer"},
                    "max_usd": {"type": "number"},
                },
            },
            "needs_confirmation": {"type": "array", "items": {"type": "string"}},
        },
        "required": [
            "count",
            "categories",
            "market_keys",
            "require_decision_maker",
            "recurring_only",
            "min_lead_score",
            "budget",
            "needs_confirmation",
        ],
    }


def _build_context(settings: Settings) -> dict[str, list[str]]:
    markets = load_markets(settings.config_dir)
    categories = load_categories(settings.config_dir)
    return {
        "markets": sorted(markets.keys()),
        "categories": sorted(categories.keys()),
    }


def _fallback_spec(prompt: str, settings: Settings) -> LeadRequestSpec:
    """Heuristic parser when AI Gateway is unavailable."""
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
        budget=BudgetCap(),
        needs_confirmation=["Parsed without AI Gateway — review spec before running"],
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

    budget_data = data.get("budget") or {}
    budget = BudgetCap(
        max_firecrawl_credits=int(budget_data.get("max_firecrawl_credits") or 200),
        max_usd=float(budget_data.get("max_usd") or 10.0),
    )

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
    """Build a validated spec from structured input (e.g. the dashboard builder).

    Skips LLM parsing entirely; still validates market/category keys against
    config and records unknown keys in needs_confirmation.
    """
    return _dict_to_spec(data, prompt=prompt, settings=settings)


def parse_lead_request(
    prompt: str,
    settings: Settings,
    *,
    store: LeadStore | None = None,
    request_id: str | None = None,
) -> LeadRequestSpec:
    """Parse a natural-language lead request into a typed spec."""
    if not gateway_configured(settings):
        logger.warning("AI Gateway not configured — using heuristic request parser")
        return _fallback_spec(prompt, settings)

    context = _build_context(settings)
    user_content = json.dumps(
        {
            "request": prompt,
            "configured_markets": context["markets"],
            "configured_categories": context["categories"],
        },
        ensure_ascii=False,
    )

    completion = gateway_chat_completion(
        settings,
        system_prompt=SYSTEM_PROMPT,
        user_content=user_content,
        store=store,
        request_id=request_id,
        operation="planner",
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "lead_request_spec",
                "schema": _spec_schema(),
                "strict": False,
            },
        },
        prompt_version=PROMPT_VERSION,
        temperature=0,
    )
    if not completion or not completion.content:
        return _fallback_spec(prompt, settings)
    parsed = parse_json_from_llm(completion.content)
    if not parsed:
        return _fallback_spec(prompt, settings)
    return _dict_to_spec(parsed, prompt=prompt, settings=settings)


def estimate_request_cost(spec: LeadRequestSpec) -> dict[str, float | int]:
    """Rough cost estimate for dry-run display."""
    # map 1 + scrape_json 5 + bbb 3 + search contingency 4 ≈ 13 credits/lead
    per_lead_credits = 13
    discovery_credits = len(spec.categories) * len(spec.market_keys) * 2
    enrich_credits = spec.count * per_lead_credits
    total_credits = discovery_credits + enrich_credits
    usd = total_credits * 0.00533
    return {
        "discovery_credits_est": discovery_credits,
        "enrich_credits_est": enrich_credits,
        "total_credits_est": min(total_credits, spec.budget.max_firecrawl_credits),
        "usd_est": min(usd, spec.budget.max_usd),
    }

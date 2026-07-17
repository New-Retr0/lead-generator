from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

_DEFAULT_FIRECRAWL_PLANS: dict[str, Any] = {
    "standard": {
        "name": "Standard",
        "monthly_credits": 100000,
        "monthly_usd": 83,
        "billing": "billed yearly",
        "concurrent_browsers": 50,
        "max_queued_jobs": 100000,
        "rate_limits_rpm": {
            "scrape": 500,
            "map": 500,
            "crawl": 50,
            "search": 250,
            "agent": 500,
        },
    },
}

_DEFAULT_PRICING: dict[str, Any] = {
    "firecrawl": {
        "default_plan_key": "standard",
        "credit_usd": 0.00083,
        "plans": _DEFAULT_FIRECRAWL_PLANS,
    },
    "google_places": {
        "text_search_usd": 0.032,
        "nearby_search_usd": 0.032,
        "health_check_usd": 0.0,
    },
    "ai_gateway": {
        "default_model": "gpt-4o-mini",
        "models": {
            "gpt-4o-mini": {
                "input_token_usd": 0.00000015,
                "output_token_usd": 0.0000006,
            },
        },
    },
}


def load_pricing(config_dir: Path | None = None) -> dict[str, Any]:
    if config_dir is None:
        from pallares_leads.settings import get_settings

        config_dir = get_settings().config_dir
    path = config_dir / "pricing.yaml"
    if not path.is_file():
        return dict(_DEFAULT_PRICING)
    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return data if isinstance(data, dict) else dict(_DEFAULT_PRICING)


def firecrawl_plans(pricing: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Return configured Firecrawl plans keyed by stable plan id."""
    plans = (pricing.get("firecrawl") or {}).get("plans")
    if not isinstance(plans, dict):
        return dict(_DEFAULT_FIRECRAWL_PLANS)
    return {str(key): value for key, value in plans.items() if isinstance(value, dict)}


def infer_firecrawl_plan(
    pricing: dict[str, Any],
    *,
    plan_credits: float | int | None = None,
    max_concurrency: float | int | None = None,
) -> tuple[str | None, dict[str, Any] | None]:
    """Infer the current Firecrawl public plan from live API credit/concurrency data."""
    plans = firecrawl_plans(pricing)
    if plan_credits is not None:
        try:
            credits = int(float(plan_credits))
        except (TypeError, ValueError):
            credits = 0
        for key, plan in plans.items():
            if int(plan.get("monthly_credits") or 0) == credits:
                return key, plan

    if max_concurrency is not None:
        try:
            concurrency = int(float(max_concurrency))
        except (TypeError, ValueError):
            concurrency = 0
        for key, plan in plans.items():
            if int(plan.get("concurrent_browsers") or 0) == concurrency:
                return key, plan

    default_key = str((pricing.get("firecrawl") or {}).get("default_plan_key") or "")
    return (default_key, plans.get(default_key)) if default_key in plans else (None, None)


def firecrawl_credit_usd(
    pricing: dict[str, Any],
    *,
    plan_credits: float | int | None = None,
) -> float:
    """Return USD/credit using the inferred plan when possible, otherwise config fallback."""
    _, plan = infer_firecrawl_plan(pricing, plan_credits=plan_credits)
    if plan:
        try:
            credits = float(plan.get("monthly_credits") or 0)
            usd = float(plan.get("monthly_usd") or 0)
            if credits > 0 and usd > 0:
                return usd / credits
        except (TypeError, ValueError):
            pass
    return float((pricing.get("firecrawl") or {}).get("credit_usd") or 0)


def usd_for(
    pricing: dict[str, Any],
    *,
    provider: str,
    operation: str,
    units: float = 0,
    unit_type: str = "credits",
    model: str | None = None,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
) -> float:
    """Estimate USD for a provider operation from config/pricing.yaml."""
    if provider == "firecrawl":
        rate = firecrawl_credit_usd(pricing)
        return round(units * rate, 6)

    if provider == "google_places":
        places = pricing.get("google_places") or {}
        key = f"{operation}_usd"
        rate = float(places.get(key) or 0)
        if rate == 0 and operation in ("text_search", "nearby_search"):
            rate = float(places.get(f"{operation}_usd") or 0)
        return round(units * rate, 6)

    if provider == "ai_gateway":
        gateway = pricing.get("ai_gateway") or {}
        models = gateway.get("models") or {}
        model_key = model or gateway.get("default_model") or ""
        rates = models.get(model_key) or {}
        input_rate = float(rates.get("input_token_usd") or 0)
        output_rate = float(rates.get("output_token_usd") or 0)
        if unit_type == "tokens" and units > 0 and prompt_tokens == 0 and completion_tokens == 0:
            return round(units * input_rate, 6)
        return round(
            prompt_tokens * input_rate + completion_tokens * output_rate,
            6,
        )

    return 0.0

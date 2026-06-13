from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

_DEFAULT_PRICING: dict[str, Any] = {
    "firecrawl": {"credit_usd": 0.01},
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
        rate = float((pricing.get("firecrawl") or {}).get("credit_usd") or 0)
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

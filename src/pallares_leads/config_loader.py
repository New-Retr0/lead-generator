from __future__ import annotations

from pathlib import Path
from typing import NotRequired, TypedDict

import yaml


class MarketConfig(TypedDict):
    city: str
    state: str
    region: str
    latitude: NotRequired[float]
    longitude: NotRequired[float]
    search_radius_m: NotRequired[int]


class CategoryConfig(TypedDict):
    label: str
    property_type: str
    queries: list[str]
    included_type: NotRequired[str]
    nearby_types: NotRequired[list[str]]


def load_markets(config_dir: Path) -> dict[str, MarketConfig]:
    path = config_dir / "markets.yaml"
    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f)
    markets = data.get("markets", {})
    if not isinstance(markets, dict):
        raise ValueError("markets.yaml: expected 'markets' mapping")
    return markets


def load_categories(config_dir: Path) -> dict[str, CategoryConfig]:
    path = config_dir / "categories.yaml"
    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f)
    categories = data.get("categories", {})
    if not isinstance(categories, dict):
        raise ValueError("categories.yaml: expected 'categories' mapping")
    return categories

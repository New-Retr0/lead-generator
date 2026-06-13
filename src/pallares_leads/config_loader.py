from __future__ import annotations

from pathlib import Path
from typing import NotRequired, TypedDict

import yaml
from pydantic import BaseModel, Field


class MarketConfig(TypedDict):
    city: str
    state: str
    region: str
    county: NotRequired[str]
    latitude: NotRequired[float]
    longitude: NotRequired[float]
    search_radius_m: NotRequired[int]
    bbox: NotRequired[list[float]]
    city_site: NotRequired[str]


class CategoryConfig(TypedDict):
    label: str
    property_type: str
    queries: list[str]
    included_type: NotRequired[str]
    nearby_types: NotRequired[list[str]]
    source: NotRequired[str]
    overpass_filter: NotRequired[str]
    area_min_m2: NotRequired[float]
    area_max_m2: NotRequired[float]
    prefer_private_access: NotRequired[bool]


class CampaignConfig(TypedDict):
    description: str
    markets: list[str]
    categories: list[str]
    county_overrides: NotRequired[dict[str, str]]


class PortalConfig(BaseModel):
    adapter: str
    url: str
    owner_names_online: bool | str = True
    free_search_cap: int | None = None


class StateJurisdictionConfig(BaseModel):
    sos_business_search: PortalConfig


class CountyJurisdictionConfig(BaseModel):
    state: str
    recorder: PortalConfig | None = None
    parcel_portal: PortalConfig | None = None


class JurisdictionRegistry(BaseModel):
    states: dict[str, StateJurisdictionConfig] = Field(default_factory=dict)
    counties: dict[str, CountyJurisdictionConfig] = Field(default_factory=dict)

    def county_for_market(self, market: MarketConfig) -> CountyJurisdictionConfig | None:
        county_key = market.get("county")
        if not county_key:
            return None
        return self.counties.get(county_key)

    def state_for_county(self, county: CountyJurisdictionConfig) -> StateJurisdictionConfig | None:
        return self.states.get(county.state)


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


def load_campaigns(config_dir: Path) -> dict[str, CampaignConfig]:
    path = config_dir / "campaign.yaml"
    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f)
    campaigns = data.get("campaigns", {})
    if not isinstance(campaigns, dict):
        raise ValueError("campaign.yaml: expected 'campaigns' mapping")
    return campaigns


def load_jurisdictions(config_dir: Path) -> JurisdictionRegistry:
    path = config_dir / "jurisdictions.yaml"
    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return JurisdictionRegistry.model_validate(data)


def load_licensing(config_dir: Path) -> dict:
    path = config_dir / "licensing.yaml"
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def load_sources(config_dir: Path) -> dict:
    path = config_dir / "sources.yaml"
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as f:
        return yaml.safe_load(f) or {}

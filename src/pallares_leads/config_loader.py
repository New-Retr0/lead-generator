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
    grid_radius_m: NotRequired[int]
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
    exclude_counties: NotRequired[list[str]]


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
    fbn_lookup: PortalConfig | None = None


class JurisdictionRegistry(BaseModel):
    states: dict[str, StateJurisdictionConfig] = Field(default_factory=dict)
    counties: dict[str, CountyJurisdictionConfig] = Field(default_factory=dict)
    city_portals: dict[str, dict[str, PortalConfig]] = Field(default_factory=dict)

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


def validate_all_config(config_dir: Path) -> list[str]:
    """Load every config file and return a list of validation problems."""
    problems: list[str] = []
    try:
        markets = load_markets(config_dir)
    except Exception as exc:
        return [f"markets.yaml: {exc}"]
    try:
        categories = load_categories(config_dir)
    except Exception as exc:
        return [f"categories.yaml: {exc}"]
    try:
        campaigns = load_campaigns(config_dir)
    except Exception as exc:
        return [f"campaign.yaml: {exc}"]
    jurisdictions: JurisdictionRegistry | None = None
    try:
        jurisdictions = load_jurisdictions(config_dir)
    except Exception as exc:
        problems.append(f"jurisdictions.yaml: {exc}")
    try:
        load_licensing(config_dir)
    except Exception as exc:
        problems.append(f"licensing.yaml: {exc}")
    try:
        load_sources(config_dir)
    except Exception as exc:
        problems.append(f"sources.yaml: {exc}")

    for key, campaign in campaigns.items():
        for market_key in campaign.get("markets") or []:
            if market_key not in markets:
                problems.append(f"campaign {key!r}: unknown market {market_key!r}")
        for category_key in campaign.get("categories") or []:
            if category_key not in categories:
                problems.append(f"campaign {key!r}: unknown category {category_key!r}")
        if jurisdictions:
            for county_key in campaign.get("exclude_counties") or []:
                if county_key not in jurisdictions.counties:
                    problems.append(
                        f"campaign {key!r}: exclude_counties references unknown county {county_key!r}"
                    )

    for category_key, cfg in categories.items():
        prop = cfg.get("property_type") or category_key
        try:
            from pallares_leads.enrich.contact_requirements import get_enrichment_rules

            get_enrichment_rules(prop, config_dir)
        except ValueError as exc:
            problems.append(f"categories.yaml/{category_key}: {exc}")

    try:
        from pallares_leads.enrich.contact_requirements import EnrichmentRules

        cat_path = config_dir / "categories.yaml"
        with cat_path.open(encoding="utf-8") as handle:
            cat_data = yaml.safe_load(handle) or {}
        EnrichmentRules.from_mapping(cat_data.get("enrichment_defaults"))
    except ValueError as exc:
        problems.append(f"categories.yaml enrichment_defaults: {exc}")

    return problems


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

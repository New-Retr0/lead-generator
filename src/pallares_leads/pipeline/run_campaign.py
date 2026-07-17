from __future__ import annotations

import csv
import logging
from dataclasses import dataclass, field

from pallares_leads.config_loader import (
    CampaignConfig,
    MarketConfig,
    load_campaigns,
    load_categories,
    load_markets,
)
from pallares_leads.db.store import LeadStore
from pallares_leads.pipeline.run_market import run_market_category
from pallares_leads.schemas import EnrichedLead
from pallares_leads.settings import Settings

logger = logging.getLogger(__name__)

DEFAULT_CAMPAIGN = "central_valley"


@dataclass
class CampaignRunResult:
    market_key: str
    category_key: str
    lead_count: int
    csv_path: str | None = None
    error: str | None = None


@dataclass
class CampaignSummary:
    results: list[CampaignRunResult] = field(default_factory=list)
    total_leads: int = 0
    all_enriched: list[EnrichedLead] = field(default_factory=list)

    @property
    def failures(self) -> list[CampaignRunResult]:
        return [r for r in self.results if r.error]


def resolve_market_for_category(
    *,
    market_key: str,
    category_key: str,
    campaign: CampaignConfig,
    markets: dict[str, MarketConfig],
) -> tuple[str, MarketConfig]:
    overrides = campaign.get("county_overrides") or {}
    if category_key in overrides:
        county_key = overrides[category_key]
        if county_key not in markets:
            raise ValueError(f"County override {county_key!r} not found in markets.yaml")
        return county_key, markets[county_key]
    if market_key not in markets:
        raise ValueError(f"Market {market_key!r} not found in markets.yaml")
    return market_key, markets[market_key]


def iter_campaign_jobs(
    campaign: CampaignConfig,
    *,
    markets: dict[str, MarketConfig] | None = None,
    market_filter: list[str] | None = None,
    category_filter: list[str] | None = None,
) -> list[tuple[str, str]]:
    """Return (display_market_key, category_key) pairs for a campaign run."""
    market_keys = campaign["markets"]
    categories = campaign["categories"]
    overrides = campaign.get("county_overrides") or {}
    exclude_counties = campaign.get("exclude_counties") or []

    if market_filter:
        market_keys = [m for m in market_keys if m in market_filter]

    if exclude_counties and markets:
        market_keys = [
            key
            for key in market_keys
            if markets.get(key, {}).get("county") not in exclude_counties
        ]

    if category_filter:
        categories = [c for c in categories if c in category_filter]

    jobs: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()

    for market_key in market_keys:
        for category_key in categories:
            if category_key in overrides:
                # County-level category runs once per campaign, not per city
                if market_key != market_keys[0]:
                    continue
                override_key = overrides[category_key]
                if exclude_counties and markets:
                    county = markets.get(override_key, {}).get("county")
                    if county in exclude_counties:
                        continue
                job_key = (override_key, category_key)
            else:
                job_key = (market_key, category_key)

            if job_key in seen:
                continue
            seen.add(job_key)
            jobs.append(job_key)

    return jobs


def run_campaign(
    *,
    settings: Settings,
    campaign_key: str = DEFAULT_CAMPAIGN,
    limit: int | None = None,
    discover_only: bool = False,
    dry_run: bool = False,
    market_filter: list[str] | None = None,
    category_filter: list[str] | None = None,
    skip_known: bool = True,
    force_refresh: bool = False,
    refresh_after_days: int | None = None,
) -> CampaignSummary:
    campaigns = load_campaigns(settings.config_dir)
    if campaign_key not in campaigns:
        known = ", ".join(sorted(campaigns))
        raise ValueError(f"Unknown campaign {campaign_key!r}. Options: {known}")

    campaign = campaigns[campaign_key]
    markets = load_markets(settings.config_dir)
    categories = load_categories(settings.config_dir)

    summary = CampaignSummary()
    jobs = iter_campaign_jobs(
        campaign,
        markets=markets,
        market_filter=market_filter,
        category_filter=category_filter,
    )
    exclude_counties = campaign.get("exclude_counties")

    logger.info(
        "Campaign %r: %d job(s), limit=%s, enrich=%s, skip_known=%s",
        campaign_key,
        len(jobs),
        limit,
        not discover_only,
        skip_known and not force_refresh,
    )

    with LeadStore() as store:
        for market_key, category_key in jobs:
            if category_key not in categories:
                summary.results.append(
                    CampaignRunResult(
                        market_key, category_key, 0, error=f"Unknown category {category_key!r}"
                    )
                )
                continue

            try:
                resolved_market_key, market = resolve_market_for_category(
                    market_key=market_key,
                    category_key=category_key,
                    campaign=campaign,
                    markets=markets,
                )
                out_path = run_market_category(
                    settings=settings,
                    market_key=resolved_market_key,
                    market=market,
                    category_key=category_key,
                    category=categories[category_key],
                    discover_only=discover_only,
                    dry_run=dry_run,
                    campaign_sink=summary.all_enriched,
                    limit=limit,
                    skip_known=skip_known,
                    force_refresh=force_refresh,
                    refresh_after_days=refresh_after_days,
                    store=store,
                    exclude_counties=exclude_counties,
                )
                lead_count = limit or 0
                if out_path and not dry_run:
                    with out_path.open(encoding="utf-8", newline="") as f:
                        lead_count = sum(1 for _ in csv.DictReader(f))

                summary.results.append(
                    CampaignRunResult(
                        resolved_market_key,
                        category_key,
                        lead_count,
                        csv_path=str(out_path) if out_path else None,
                    )
                )
                summary.total_leads += lead_count
            except Exception as exc:
                logger.exception("Failed %s / %s", market_key, category_key)
                summary.results.append(
                    CampaignRunResult(market_key, category_key, 0, error=str(exc))
                )

    return summary

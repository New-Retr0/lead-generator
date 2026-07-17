from __future__ import annotations

from pallares_leads.config_loader import MarketConfig
from pallares_leads.discover.county_filter import (
    filter_excluded_counties,
    lead_matches_excluded_county,
)
from pallares_leads.pipeline.run_campaign import iter_campaign_jobs
from pallares_leads.schemas import RawLead


def _lead(**overrides) -> RawLead:
    base = {
        "place_id": "ChIJtest",
        "business_name": "Test Plaza",
        "formatted_address": "100 Main St, Fresno, CA 93721",
        "city": "Fresno",
        "state": "CA",
        "property_type": "strip_mall",
        "lead_category": "Strip Mall",
        "market_key": "fresno",
    }
    base.update(overrides)
    return RawLead(**base)


def test_lead_matches_excluded_county_by_market() -> None:
    markets: dict[str, MarketConfig] = {
        "irvine_ca": {
            "city": "Irvine",
            "state": "CA",
            "region": "socal",
            "county": "orange_ca",
        }
    }
    lead = _lead(market_key="irvine_ca", formatted_address="100 Main, Irvine, CA")
    assert lead_matches_excluded_county(lead, ["orange_ca"], markets)


def test_filter_excluded_counties_drops_la_address() -> None:
    markets: dict[str, MarketConfig] = {
        "oxnard_ca": {
            "city": "Oxnard",
            "state": "CA",
            "region": "california_expansion",
            "county": "ventura_ca",
        }
    }
    leads = [
        _lead(
            market_key="oxnard_ca",
            formatted_address="100 Main, Los Angeles County, CA",
        ),
        _lead(market_key="oxnard_ca", formatted_address="100 Main, Oxnard, CA"),
    ]
    kept, skipped = filter_excluded_counties(leads, ["los_angeles_ca"], markets)
    assert skipped == 1
    assert len(kept) == 1


def test_iter_campaign_jobs_skips_excluded_markets() -> None:
    markets: dict[str, MarketConfig] = {
        "san_diego_ca": {
            "city": "San Diego",
            "state": "CA",
            "region": "california_expansion",
            "county": "san_diego_ca",
        },
        "irvine_ca": {
            "city": "Irvine",
            "state": "CA",
            "region": "socal",
            "county": "orange_ca",
        },
    }
    campaign = {
        "description": "test",
        "markets": ["san_diego_ca", "irvine_ca"],
        "categories": ["strip_mall"],
        "exclude_counties": ["orange_ca"],
    }
    jobs = iter_campaign_jobs(campaign, markets=markets)
    assert jobs == [("san_diego_ca", "strip_mall")]

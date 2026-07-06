from __future__ import annotations

from pallares_leads.config_loader import MarketConfig
from pallares_leads.schemas import RawLead

# Substrings matched case-insensitively against formatted_address.
_COUNTY_ADDRESS_HINTS: dict[str, tuple[str, ...]] = {
    "los_angeles_ca": ("los angeles county", " los angeles, ca", " la county,"),
    "orange_ca": ("orange county", " orange, ca"),
}


def lead_matches_excluded_county(
    lead: RawLead,
    exclude_counties: list[str],
    markets: dict[str, MarketConfig],
) -> bool:
    """True when a lead should be dropped due to campaign county exclusions."""
    if not exclude_counties:
        return False

    market = markets.get(lead.market_key or "")
    county_key = market.get("county") if market else None
    if county_key and county_key in exclude_counties:
        return True

    address = (lead.formatted_address or "").lower()
    for county_key in exclude_counties:
        for hint in _COUNTY_ADDRESS_HINTS.get(county_key, ()):
            if hint in address:
                return True
    return False


def filter_excluded_counties(
    leads: list[RawLead],
    exclude_counties: list[str] | None,
    markets: dict[str, MarketConfig],
) -> tuple[list[RawLead], int]:
    if not exclude_counties:
        return leads, 0
    kept: list[RawLead] = []
    skipped = 0
    for lead in leads:
        if lead_matches_excluded_county(lead, exclude_counties, markets):
            skipped += 1
            continue
        kept.append(lead)
    return kept, skipped

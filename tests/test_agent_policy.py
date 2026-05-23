from __future__ import annotations

from pallares_leads.enrich.contact_requirements import (
    EnrichmentRules,
    agent_permitted,
    clear_enrichment_rules_cache,
)
from pallares_leads.enrich.firecrawl_client import FirecrawlClient
from pallares_leads.schemas import RawLead
from pallares_leads.settings import Settings


def _raw(**overrides) -> RawLead:
    base = {
        "place_id": "ChIJtest",
        "business_name": "Test Store",
        "formatted_address": "100 Main St, Reedley, CA",
        "city": "Reedley",
        "state": "CA",
        "property_type": "gas_station",
        "lead_category": "Gas Station",
        "website": "https://find.shell.com/us/fuel/123",
        "main_phone": "(559) 638-0100",
    }
    base.update(overrides)
    return RawLead(**base)


def test_agent_disabled_by_default() -> None:
    clear_enrichment_rules_cache()
    settings = Settings(firecrawl_agent_enabled=False)
    rules = EnrichmentRules(allow_agent=True)
    permitted, reason = agent_permitted(_raw(), rules, settings)
    assert permitted is False
    assert "disabled" in reason.lower()


def test_agent_blocked_when_category_disallows() -> None:
    settings = Settings(firecrawl_api_key="x", firecrawl_agent_enabled=True)
    rules = EnrichmentRules(allow_agent=False)
    permitted, reason = agent_permitted(_raw(), rules, settings)
    assert permitted is False
    assert "allow_agent=false" in reason


def test_agent_blocked_for_maps_only_website() -> None:
    settings = Settings(firecrawl_agent_enabled=True)
    rules = EnrichmentRules(allow_agent=True)
    raw = _raw(website="https://maps.google.com/?cid=123")
    permitted, reason = agent_permitted(raw, rules, settings)
    assert permitted is False
    assert "Maps" in reason


def test_agent_focus_urls_drop_maps() -> None:
    raw = _raw(website="https://find.shell.com/us/fuel/123")
    urls = FirecrawlClient._agent_focus_urls(
        raw,
        ["https://maps.google.com/?cid=999", "https://find.shell.com/us/fuel/123"],
    )
    assert all("maps.google" not in u for u in urls)
    assert urls[0].startswith("https://find.shell")


def test_agent_focus_urls_empty_when_only_maps() -> None:
    raw = _raw(website="https://maps.google.com/?cid=123")
    urls = FirecrawlClient._agent_focus_urls(raw, ["https://maps.google.com/?cid=123"])
    assert urls == []

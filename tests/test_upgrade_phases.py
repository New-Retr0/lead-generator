"""Tests for Phase 0–2 pipeline upgrade items."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from pallares_leads.config_loader import validate_all_config
from pallares_leads.enrich.apply import derive_best_contact_fields
from pallares_leads.enrich.firecrawl_client import _SHARED_MAP_CACHE, FirecrawlClient
from pallares_leads.enrich.registries.bbb import bbb_contacts, parse_bbb_profile
from pallares_leads.schemas import EnrichedLead, InvestigationStatus, RawLead, SiteContact
from pallares_leads.settings import Settings
from pallares_leads.utils.http_retry import OutOfCreditsError, request_with_retry


def test_search_web_tracks_search_credits():
    payload = {"success": True, "data": []}
    assert FirecrawlClient._credits_from_payload(payload, operation="search") == 2
    assert FirecrawlClient._credits_from_payload(payload, operation="scrape") == 0


def test_http_retry_raises_out_of_credits_on_402():
    response = MagicMock()
    response.status_code = 402
    response.headers = {}

    with pytest.raises(OutOfCreditsError):
        request_with_retry(lambda: response, label="test")


def test_sales_status_requires_verification():
    raw = RawLead(
        place_id="p1",
        business_name="Test",
        formatted_address="1 Main",
        city="Reedley",
        state="CA",
        property_type="strip_mall",
        lead_category="Strip Mall",
    )
    lead = EnrichedLead.model_validate(raw.model_dump())
    lead.investigation_status = InvestigationStatus.ENRICHED
    lead.site_contacts = [
        SiteContact(email="info@example.com", verification="verified"),
    ]
    lead.verification_level = "unverified"
    assert lead.sales_status() == "Needs research"

    lead.verification_level = "partial"
    assert lead.sales_status() == "Ready to call"


def test_best_contact_prefers_verified_over_unverified():
    raw = RawLead(
        place_id="p2",
        business_name="Test",
        formatted_address="1 Main",
        city="Reedley",
        state="CA",
        property_type="strip_mall",
        lead_category="Strip Mall",
    )
    lead = EnrichedLead.model_validate(raw.model_dump())
    lead.site_contacts = [
        SiteContact(
            name="Unverified Person",
            phone="(559) 638-1111",
            label="Manager",
            verification="unverified",
        ),
        SiteContact(
            name="Verified Person",
            phone="(559) 638-2222",
            label="Facilities Manager",
            verification="verified",
        ),
    ]
    lead = derive_best_contact_fields(lead)
    assert lead.best_contact_phone == "(559) 638-2222"
    assert lead.best_contact_name == "Verified Person"


def test_validate_all_config_ok():
    settings = Settings()
    problems = validate_all_config(settings.config_dir)
    assert problems == [], problems


def test_validate_all_config_rejects_bad_contact_bar(tmp_path):
    import shutil

    from pallares_leads.enrich.contact_requirements import clear_enrichment_rules_cache

    settings = Settings()
    config_dir = tmp_path / "config"
    shutil.copytree(settings.config_dir, config_dir)
    categories_path = config_dir / "categories.yaml"
    text = categories_path.read_text(encoding="utf-8")
    categories_path.write_text(
        text.replace("min_contact_bar: phone", "min_contact_bar: not_a_bar", 1),
        encoding="utf-8",
    )
    clear_enrichment_rules_cache()
    problems = validate_all_config(config_dir)
    clear_enrichment_rules_cache()
    assert any("min_contact_bar" in p or "not_a_bar" in p for p in problems)


def test_bbb_contacts_ground_names():
    markdown = (
        "Business Management\n"
        "Mr. Ahmad A. Jaber, President\n"
        "Additional Phone Numbers\n(559) 743-7184"
    )
    profile = parse_bbb_profile(markdown, url="https://bbb.org/profile")
    contacts = bbb_contacts(profile, page_text=markdown)
    assert contacts[0].verification == "verified"
    assert contacts[0].name == "Ahmad A. Jaber"
    phone_contacts = [c for c in contacts if c.phone]
    assert phone_contacts[0].verification == "verified"

    contacts_bad = bbb_contacts(profile, page_text="unrelated page text")
    assert contacts_bad[0].verification == "unverified"


def test_map_cache_shared_across_clients():
    _SHARED_MAP_CACHE.clear()
    settings = Settings(firecrawl_api_key="test-key")
    fc = FirecrawlClient(settings)
    _SHARED_MAP_CACHE["https://example.com"] = ["https://example.com/contact"]

    with patch.object(FirecrawlClient, "_sdk_call_with_retry") as mock_sdk:
        links = fc.map_contact_urls("https://example.com/contact-us", limit=5)

    assert links == ["https://example.com/contact"]
    mock_sdk.assert_not_called()
    _SHARED_MAP_CACHE.clear()

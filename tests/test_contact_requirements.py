from __future__ import annotations

from pathlib import Path

import pytest

from pallares_leads.enrich.contact_requirements import (
    EnrichmentRules,
    clear_enrichment_rules_cache,
    get_enrichment_rules,
    investigation_meets_bar,
    tier2_gap_reason,
)
from pallares_leads.enrich.schema import LeadInvestigationResult
from pallares_leads.schemas import RawLead, SiteContact
from pallares_leads.settings import Settings


@pytest.fixture
def config_dir() -> Path:
    clear_enrichment_rules_cache()
    return Settings().config_dir


def test_default_bar_requires_phone_not_form(config_dir: Path) -> None:
    rules = get_enrichment_rules("gas_station", config_dir)
    assert rules.min_contact_bar == "phone"

    form_only = LeadInvestigationResult(contact_form_url="https://example.com/contact")
    met, detail = investigation_meets_bar(form_only, rules)
    assert met is False
    assert "form" in detail


def test_phone_passes_default_bar(config_dir: Path) -> None:
    rules = get_enrichment_rules("gas_station", config_dir)
    result = LeadInvestigationResult(contact_phone="(559) 638-0100")
    met, _ = investigation_meets_bar(result, rules)
    assert met is True


def test_strip_mall_requires_labeled_phone(config_dir: Path) -> None:
    rules = get_enrichment_rules("strip_mall", config_dir)
    assert rules.min_contact_bar == "labeled_phone"
    assert rules.require_property_manager_clue is True

    bare_phone = LeadInvestigationResult(contact_phone="(559) 638-0100")
    met, detail = investigation_meets_bar(bare_phone, rules)
    assert met is False
    assert "labeled_phone" in detail or "property manager" in detail

    labeled = LeadInvestigationResult(
        contact_phone="(559) 638-0100",
        contact_role="Leasing Manager",
        property_manager="ABC Management",
    )
    met, _ = investigation_meets_bar(labeled, rules)
    assert met is True


def test_tier2_gap_triggers_on_form_only_gas(config_dir: Path) -> None:
    raw = RawLead(
        place_id="ChIJtest",
        business_name="Chevron",
        formatted_address="950 I St, Reedley, CA",
        city="Reedley",
        state="CA",
        property_type="gas_station",
        lead_category="Gas Station",
        website="https://www.chevronwithtechron.com/station",
        main_phone="(209) 948-9412",
    )
    settings = Settings(config_dir=config_dir)
    form_only = LeadInvestigationResult(
        contact_form_url="https://www.chevronwithtechron.com/en_us/home/contact-us.html"
    )
    needed, reason = tier2_gap_reason(form_only, raw, settings=settings)
    assert needed is True
    assert "contact bar" in reason


def test_tier2_skips_when_bar_met(config_dir: Path) -> None:
    raw = RawLead(
        place_id="ChIJtest",
        business_name="Carl's Jr.",
        formatted_address="100 Main St, Reedley, CA",
        city="Reedley",
        state="CA",
        property_type="fast_food",
        lead_category="Fast Food",
        website="https://example.com",
        main_phone="(559) 638-0100",
    )
    settings = Settings(config_dir=config_dir)
    result = LeadInvestigationResult(contact_phone="(559) 638-1111")
    needed, _ = tier2_gap_reason(result, raw, settings=settings)
    assert needed is False


def test_custom_rules_without_category_name_in_python() -> None:
    rules = EnrichmentRules(min_contact_bar="email")
    result = LeadInvestigationResult(contact_email="info@example.com")
    met, _ = investigation_meets_bar(result, rules)
    assert met is True

    result = LeadInvestigationResult(
        site_contacts=[SiteContact(label="Front desk", email="desk@example.com")]
    )
    met, _ = investigation_meets_bar(result, rules)
    assert met is True

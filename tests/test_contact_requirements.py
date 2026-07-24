from __future__ import annotations

from pathlib import Path

import pytest

from pallares_leads.enrich.contact_requirements import (
    EnrichmentRules,
    clear_enrichment_rules_cache,
    contact_package_complete,
    contact_package_gaps,
    get_enrichment_rules,
    has_atomic_named_decision_maker,
    investigation_meets_bar,
    is_decision_maker_role,
    is_junk_role,
    needs_package_enrichment,
    tier2_gap_reason,
)
from pallares_leads.enrich.schema import LeadInvestigationResult
from pallares_leads.schemas import EnrichedLead, RawLead, SiteContact
from pallares_leads.settings import Settings


def _cre_lead(**kwargs) -> EnrichedLead:
    base = dict(
        place_id="ChIJpkg",
        business_name="Reedley Plaza",
        formatted_address="100 Main St, Reedley, CA",
        city="Reedley",
        state="CA",
        property_type="strip_mall",
        lead_category="Strip Mall",
        investigation_status="enriched",
        verification_level="verified",
    )
    base.update(kwargs)
    return EnrichedLead(**base)


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
    met, detail = investigation_meets_bar(bare_phone, rules, property_type="strip_mall")
    assert met is False
    assert "labeled_phone" in detail or "property manager" in detail or "decision-maker" in detail

    # Role + phone without a first+last name is not Partner-aligned — keep ladder going.
    labeled_only = LeadInvestigationResult(
        contact_phone="(559) 638-0100",
        contact_role="Leasing Manager",
        property_manager="ABC Management",
    )
    met, detail = investigation_meets_bar(labeled_only, rules, property_type="strip_mall")
    assert met is False
    assert "decision-maker" in detail.lower()

    named = LeadInvestigationResult(
        contact_name="Pat Rivera",
        contact_phone="(559) 638-0100",
        contact_role="Leasing Manager",
        property_manager="ABC Management",
    )
    met, _ = investigation_meets_bar(named, rules, property_type="strip_mall")
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


def test_strip_mall_google_phone_alone_does_not_skip_tier2(config_dir: Path) -> None:
    raw = RawLead(
        place_id="ChIJcre",
        business_name="Reedley Plaza",
        formatted_address="100 Main St, Reedley, CA",
        city="Reedley",
        state="CA",
        property_type="strip_mall",
        lead_category="Strip Mall",
        website="https://example-plaza.com",
        main_phone="(559) 638-0100",
    )
    settings = Settings(config_dir=config_dir)
    # Bare Google-quality phone on site with no named DM.
    result = LeadInvestigationResult(contact_phone="(559) 638-0100")
    needed, reason = tier2_gap_reason(result, raw, settings=settings)
    assert needed is True
    assert "decision-maker" in reason.lower() or "contact bar" in reason.lower()


def test_junk_role_rejected_outside_medical(config_dir: Path) -> None:
    del config_dir
    assert is_junk_role("Front Desk")
    assert is_junk_role("Reception")
    assert not is_junk_role("Facilities Manager")


def test_media_pr_roles_are_not_decision_makers(config_dir: Path) -> None:
    """Powerwash buyers are facilities/ops — not press contacts."""
    del config_dir
    for role in (
        "Media/PR Manager",
        "Media/PR Specialist",
        "Communications Director",
        "Marketing Manager",
        "Spokesperson",
    ):
        assert is_junk_role(role), role
        assert not is_decision_maker_role(role), role

    for role in (
        "Facilities Manager",
        "Property Manager",
        "Store Manager",
        "Operations Director",
        "Facilities Director",
        "Maintenance Supervisor",
    ):
        assert not is_junk_role(role), role
        assert is_decision_maker_role(role), role


def test_named_dm_requires_first_and_last() -> None:
    lead = _cre_lead(
        best_contact_name="Manager",
        best_contact_role="Property Manager",
        best_contact_phone="(559) 638-0100",
        site_contacts=[
            SiteContact(
                label="Property Manager",
                name="Manager",
                phone="(559) 638-0100",
            )
        ],
    )
    assert has_atomic_named_decision_maker(lead) is False

    lead.best_contact_name = "Pat Rivera"
    lead.site_contacts = [
        SiteContact(
            label="Property Manager",
            name="Pat Rivera",
            phone="(559) 638-0100",
        )
    ]
    assert has_atomic_named_decision_maker(lead) is True


def test_one_phone_only_dm_package_incomplete() -> None:
    lead = _cre_lead(
        best_contact_name="Pat Rivera",
        best_contact_role="Property Manager",
        best_contact_phone="(559) 638-0100",
        site_contacts=[
            SiteContact(
                label="Property Manager",
                name="Pat Rivera",
                phone="(559) 638-0100",
            )
        ],
    )
    gaps = contact_package_gaps(lead)
    assert "DM email" in gaps
    assert any("second named DM" in g for g in gaps)
    assert contact_package_complete(lead) is False

    rules = EnrichmentRules(min_contact_bar="labeled_phone", require_property_manager_clue=False)
    needed, reason = needs_package_enrichment(lead, rules)
    assert needed is True
    assert "enrich package" in reason


def test_dm_with_email_package_complete() -> None:
    lead = _cre_lead(
        best_contact_name="Pat Rivera",
        best_contact_role="Property Manager",
        best_contact_phone="(559) 638-0100",
        best_contact_email_or_form="pat@plaza.com",
        site_contacts=[
            SiteContact(
                label="Property Manager",
                name="Pat Rivera",
                phone="(559) 638-0100",
                email="pat@plaza.com",
            )
        ],
    )
    assert contact_package_gaps(lead) == []
    assert contact_package_complete(lead) is True


def test_two_named_dms_package_complete_without_email() -> None:
    lead = _cre_lead(
        best_contact_name="Pat Rivera",
        best_contact_role="Property Manager",
        best_contact_phone="(559) 638-0100",
        site_contacts=[
            SiteContact(
                label="Property Manager",
                name="Pat Rivera",
                phone="(559) 638-0100",
            ),
            SiteContact(
                label="Facilities Manager",
                name="Alex Chen",
                phone="(559) 638-2222",
            ),
        ],
    )
    assert contact_package_gaps(lead) == []
    assert contact_package_complete(lead) is True


def test_franchise_one_phone_only_dm_still_chases_email() -> None:
    lead = _cre_lead(
        property_type="fast_food",
        lead_category="Fast Food",
        best_contact_name="Morgan Lee",
        best_contact_role="Owner",
        best_contact_phone="(559) 638-3333",
        site_contacts=[
            SiteContact(label="Owner", name="Morgan Lee", phone="(559) 638-3333")
        ],
    )
    gaps = contact_package_gaps(lead)
    assert gaps == ["DM email"]
    assert contact_package_complete(lead) is False

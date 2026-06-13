from __future__ import annotations

from pathlib import Path

import pytest

from pallares_leads.enrich.contact_requirements import (
    clear_enrichment_rules_cache,
    get_enrichment_rules,
    investigation_meets_bar,
    is_patient_facing_investigation,
    tier2_gap_reason,
)
from pallares_leads.enrich.sales_copy import is_generic_copy
from pallares_leads.enrich.schema import LeadInvestigationResult
from pallares_leads.pipeline.run_market import _investigation_outputs
from pallares_leads.resolve.contact_hierarchy import pick_best_contact
from pallares_leads.schemas import ExtractedContact, RawLead
from pallares_leads.settings import Settings


@pytest.fixture(autouse=True)
def _clear_cache() -> None:
    clear_enrichment_rules_cache()


@pytest.fixture
def config_dir() -> Path:
    return Settings().config_dir


def test_investigation_outputs_rejects_not_specified_phone() -> None:
    result = LeadInvestigationResult(contact_phone="Not Specified")
    outputs = _investigation_outputs(result)
    assert outputs["has_phone"] is False


def test_medical_patient_line_fails_labeled_bar(config_dir: Path) -> None:
    rules = get_enrichment_rules("medical_plaza", config_dir)
    result = LeadInvestigationResult(
        contact_phone="(559) 638-0100",
        contact_role="Patient Scheduling",
    )
    assert is_patient_facing_investigation(result, property_type="medical_plaza") is True
    met, detail = investigation_meets_bar(result, rules, property_type="medical_plaza")
    assert met is False
    assert "facilities" in detail or "patient" in detail.lower()


def test_medical_facilities_passes_labeled_bar(config_dir: Path) -> None:
    rules = get_enrichment_rules("medical_plaza", config_dir)
    result = LeadInvestigationResult(
        contact_phone="(559) 638-0100",
        contact_role="Facilities Manager",
    )
    met, _ = investigation_meets_bar(result, rules, property_type="medical_plaza")
    assert met is True


def test_property_manager_trusts_google_phone_when_tier1_weak(config_dir: Path) -> None:
    raw = RawLead(
        place_id="ChIJpm",
        business_name="Sayland Property Management",
        formatted_address="100 Main, Reedley, CA",
        city="Reedley",
        state="CA",
        property_type="property_manager",
        lead_category="Property Manager",
        website="https://example.com",
        main_phone="(559) 638-2222",
    )
    settings = Settings(config_dir=config_dir)
    form_only = LeadInvestigationResult(contact_form_url="https://example.com/contact")
    needed, reason = tier2_gap_reason(form_only, raw, settings=settings)
    assert needed is False
    assert "Google main line" in reason


def test_franchise_hierarchy_prefers_store_manager() -> None:
    contacts = [
        ExtractedContact(
            contact_type="property_manager", role="Property Manager", phone="(559) 638-1111"
        ),
        ExtractedContact(
            contact_type="general_manager", role="Store Manager", phone="(559) 638-2222"
        ),
    ]
    best = pick_best_contact(contacts, property_type="fast_food")
    assert best is not None
    assert best.contact_type == "general_manager"


def test_multi_tenant_hierarchy_prefers_property_manager() -> None:
    contacts = [
        ExtractedContact(
            contact_type="property_manager", role="Property Manager", phone="(559) 638-1111"
        ),
        ExtractedContact(contact_type="general_manager", role="GM", phone="(559) 638-2222"),
    ]
    best = pick_best_contact(contacts, property_type="strip_mall")
    assert best is not None
    assert best.contact_type == "property_manager"


def test_city_mention_alone_is_generic_copy() -> None:
    why = "We help Reedley businesses maintain a pristine appearance."
    points = "• Professional exterior cleaning in Reedley"
    assert is_generic_copy(why, points, city="Reedley", business_name="Test") is True


def test_broker_service_hooks_not_generic() -> None:
    why = (
        "Reedley strip mall parking lot and dumpster enclosures "
        "fit Pallares managed vendor programs."
    )
    points = "• Photo-verified QC on every job\n• Recurring lot washing program"
    assert is_generic_copy(why, points, city="Reedley", business_name="Test") is False


def test_new_categories_exist(config_dir: Path) -> None:
    from pallares_leads.config_loader import load_categories

    categories = load_categories(config_dir)
    assert "auto_dealer" in categories
    assert "dollar_store" in categories
    assert categories["strip_mall"]["enrichment"]["always_investigate"] is True

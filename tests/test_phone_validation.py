from __future__ import annotations

import pytest

from pallares_leads.enrich.apply import apply_investigation
from pallares_leads.enrich.schema import LeadInvestigationResult
from pallares_leads.schemas import EnrichedLead, RawLead
from pallares_leads.utils.normalize import (
    is_placeholder_phone,
    pick_best_phone,
)


@pytest.mark.parametrize(
    "phone",
    [
        "559-555-0123",
        "(559) 555-1234",
        "Not Specified",
        "1234567890",
        "0000000000",
        "",
    ],
)
def test_placeholder_phones_rejected(phone: str) -> None:
    assert is_placeholder_phone(phone) is True


@pytest.mark.parametrize(
    "phone",
    [
        "(559) 638-5945",
        "5596385945",
        "+1-559-638-5945",
    ],
)
def test_real_phones_accepted(phone: str) -> None:
    assert is_placeholder_phone(phone) is False


def test_pick_best_phone_keeps_google_over_scrape_placeholder() -> None:
    assert pick_best_phone(
        "(559) 768-1040",
        ("559-555-0123", "scrape", True),
    ) == "(559) 768-1040"


def test_pick_best_phone_prefers_google_over_valid_scrape() -> None:
    assert pick_best_phone(
        "(559) 638-5945",
        ("(559) 638-1111", "scrape", True),
    ) == "(559) 638-5945"


def test_apply_investigation_does_not_overwrite_google_with_555() -> None:
    raw = RawLead(
        place_id="ChIJbk",
        business_name="Burger King",
        formatted_address="100 Main, Reedley, CA",
        city="Reedley",
        state="CA",
        property_type="fast_food",
        lead_category="Fast Food",
        main_phone="(559) 768-1040",
    )
    enriched = EnrichedLead.model_validate(raw.model_dump())
    enriched.main_phone = raw.main_phone
    result = LeadInvestigationResult(contact_phone="559-555-0123", contact_role="Store Manager")
    apply_investigation(enriched, result, source_tool="firecrawl_scrape_json")
    assert enriched.best_contact_phone == "(559) 768-1040"

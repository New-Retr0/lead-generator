from __future__ import annotations

from pallares_leads.enrich.google_gaps import GoogleGaps, is_corporate_locator_url
from pallares_leads.enrich.schema import LeadInvestigationResult
from pallares_leads.schemas import EnrichedLead, RawLead


def _raw(**overrides) -> RawLead:
    base = {
        "place_id": "ChIJtest",
        "business_name": "Reedley Shopping Center",
        "formatted_address": "100 Main St, Reedley, CA 93654",
        "city": "Reedley",
        "state": "CA",
        "property_type": "shopping_center",
        "lead_category": "Shopping Center",
        "website": "",
        "google_maps_url": "https://maps.google.com/?cid=1",
        "main_phone": "",
    }
    base.update(overrides)
    return RawLead(**base)


def test_detects_missing_website_and_phone() -> None:
    gaps = GoogleGaps.from_lead(_raw())
    assert gaps.missing_website is True
    assert gaps.missing_phone is True
    assert gaps.missing_contact is True


def test_corporate_locator_triggers_gap_fill() -> None:
    raw = _raw(website="https://find.shell.com/us/station/123", main_phone="559-638-0100")
    gaps = GoogleGaps.from_lead(raw)
    assert gaps.corporate_website is True
    assert gaps.needs_firecrawl_investigation("gas_station") is True


def test_contact_from_investigation_closes_gap() -> None:
    raw = _raw(main_phone="559-638-0100", website="https://reedleyshoppingcenter.shop")
    result = LeadInvestigationResult(contact_phone="559-433-3500", contact_name="Steve Fisher")
    gaps = GoogleGaps.from_lead(raw, investigation=result)
    assert gaps.missing_contact is False


def test_is_corporate_locator_url() -> None:
    assert is_corporate_locator_url("https://www.shell.com/locations") is True
    assert is_corporate_locator_url("https://reedleyshoppingcenter.shop") is False

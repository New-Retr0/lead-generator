from __future__ import annotations

from unittest.mock import MagicMock, patch

from pallares_leads.enrich.contact_requirements import needs_tier2_gap_fill, tier2_gap_reason
from pallares_leads.enrich.schema import LeadInvestigationResult
from pallares_leads.pipeline.run_market import enrich_lead
from pallares_leads.schemas import RawLead
from pallares_leads.settings import Settings


def _raw_lead(**overrides) -> RawLead:
    base = {
        "place_id": "ChIJtest",
        "business_name": "Test Mall",
        "formatted_address": "100 Main St, Reedley, CA 93654",
        "city": "Reedley",
        "state": "CA",
        "property_type": "strip_mall",
        "lead_category": "Strip Mall / Retail Plaza",
        "website": "https://example-mall.com",
        "google_maps_url": "https://maps.google.com/?cid=1",
        "main_phone": "(559) 638-0100",
    }
    base.update(overrides)
    return RawLead(**base)


def test_needs_tier2_for_high_value_categories_without_contact() -> None:
    raw = _raw_lead(property_type="strip_mall")
    empty = LeadInvestigationResult()
    assert needs_tier2_gap_fill(empty, raw, settings=Settings()) is True


def test_skips_tier2_for_high_value_when_contact_found() -> None:
    raw = _raw_lead(property_type="strip_mall")
    result = LeadInvestigationResult(
        contact_name="Alex Rivera",
        contact_phone="(559) 638-1111",
        contact_role="Leasing Manager",
        property_manager="ABC Property Management",
    )
    assert needs_tier2_gap_fill(result, raw, settings=Settings()) is False


def test_tier2_gap_reason_includes_explanation() -> None:
    from pallares_leads.enrich.google_gaps import GoogleGaps

    raw = _raw_lead(property_type="gas_station", website="https://find.shell.com/us/fuel/123")
    gaps = GoogleGaps(
        missing_website=False,
        missing_phone=False,
        corporate_website=True,
        missing_contact=True,
    )
    needed, reason = tier2_gap_reason(
        LeadInvestigationResult(), raw, gaps=gaps, settings=Settings()
    )
    assert needed is True
    assert "corporate locator" in reason


@patch("pallares_leads.pipeline.run_market.FirecrawlClient")
def test_hybrid_enrich_uses_scrape_json_then_tier2_search(mock_fc_cls: MagicMock) -> None:
    from pallares_leads.enrich.contact_requirements import EnrichmentRules

    settings = Settings(firecrawl_api_key="test-key")
    mock_fc = mock_fc_cls.return_value
    mock_fc.scrape_lead.return_value = LeadInvestigationResult()
    mock_fc.search_contact_gap.return_value = LeadInvestigationResult(
        contact_phone="(559) 638-1111",
        contact_role="Leasing Manager",
        property_manager="ABC Management",
    )
    mock_fc.pick_broker_pdf_url.return_value = None

    raw = _raw_lead(property_type="strip_mall")
    with patch(
        "pallares_leads.pipeline.run_market.get_enrichment_rules",
        return_value=EnrichmentRules(min_contact_bar="labeled_phone"),
    ):
        enrich_lead(raw, mock_fc, settings)

    mock_fc.reset_session_credits.assert_called_once()
    mock_fc.scrape_lead.assert_called_once()
    mock_fc.search_contact_gap.assert_called_once()

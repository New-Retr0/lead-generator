from __future__ import annotations

from unittest.mock import MagicMock, patch

from pallares_leads.enrich.contact_requirements import needs_tier2_gap_fill, tier2_gap_reason
from pallares_leads.enrich.sales_copy import (
    SalesCopyResult,
    build_research_context,
    is_generic_copy,
    needs_sales_copy,
)
from pallares_leads.enrich.schema import LeadInvestigationResult
from pallares_leads.pipeline.run_market import enrich_lead
from pallares_leads.schemas import EnrichedLead, RawLead
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


def test_is_generic_copy_detects_boilerplate() -> None:
    why = "High foot traffic and located near major roads make curb appeal important."
    points = "• Seasonal cleaning helps\n• Professional appearance matters"
    assert is_generic_copy(why, points, city="Reedley", business_name="Save Mart") is True


def test_is_generic_copy_allows_local_hooks() -> None:
    why = "Reedley Shopping Center on Manning Ave sees 19,000+ daily cars."
    points = "• Save Mart anchor draws family traffic in Reedley"
    assert (
        is_generic_copy(why, points, city="Reedley", business_name="Reedley Shopping Center")
        is False
    )


def test_needs_sales_copy_when_empty() -> None:
    lead = EnrichedLead.model_validate(_raw_lead().model_dump())
    assert needs_sales_copy(lead) is True


def test_build_research_context_includes_pdf_snippets() -> None:
    raw = _raw_lead()
    enriched = EnrichedLead.model_validate(raw.model_dump())
    enriched.exterior_cleaning_need_signals = "parking lot, signage"
    context = build_research_context(
        enriched,
        raw,
        LeadInvestigationResult(contact_phone="(559) 638-1111"),
        ["Broker flyer mentions 631 parking spaces."],
    )
    assert context["city"] == "Reedley"
    assert context["pdf_snippets"] == ["Broker flyer mentions 631 parking spaces."]
    assert context["contacts"][0]["phone"] == "(559) 638-1111"


def test_needs_tier2_for_high_value_categories_without_contact() -> None:
    raw = _raw_lead(property_type="strip_mall")
    empty = LeadInvestigationResult()
    assert needs_tier2_gap_fill(empty, raw, settings=Settings()) is True


def test_skips_tier2_for_high_value_when_contact_found() -> None:
    raw = _raw_lead(property_type="strip_mall")
    result = LeadInvestigationResult(
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


@patch("pallares_leads.pipeline.run_market.maybe_enrich_sales_copy")
@patch("pallares_leads.pipeline.run_market.FirecrawlClient")
def test_hybrid_enrich_uses_scrape_json_then_tier2_search(
    mock_fc_cls: MagicMock, mock_gateway: MagicMock
) -> None:
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
    mock_gateway.side_effect = lambda enriched, *_args, **_kwargs: enriched

    raw = _raw_lead(property_type="strip_mall")
    with patch(
        "pallares_leads.pipeline.run_market.get_enrichment_rules",
        return_value=EnrichmentRules(min_contact_bar="labeled_phone"),
    ):
        enrich_lead(raw, mock_fc, settings)

    mock_fc.reset_session_credits.assert_called_once()
    mock_fc.scrape_lead.assert_called_once()
    mock_fc.search_contact_gap.assert_called_once()
    mock_gateway.assert_called_once()


@patch("pallares_leads.enrich.sales_copy.generate_sales_copy")
@patch("pallares_leads.pipeline.run_market.FirecrawlClient")
def test_gateway_fills_empty_copy_after_markdown_fallback(
    mock_fc_cls: MagicMock,
    mock_generate: MagicMock,
) -> None:
    settings = Settings(
        firecrawl_api_key="test-key",
        ai_gateway_api_key="gw-key",
        ai_gateway_model="google/gemini-2.5-flash",
    )
    mock_fc = mock_fc_cls.return_value
    mock_fc.scrape_lead.return_value = None
    mock_fc.scrape_site.return_value = [
        ("https://example-mall.com/contact", "Call us at (559) 638-2222"),
    ]
    mock_fc.search_contact_gap.return_value = None
    mock_fc.pick_broker_pdf_url.return_value = None
    mock_generate.return_value = SalesCopyResult(
        why_call="Reedley strip mall with visible parking-lot frontage on Main St.",
        talking_points="• Mixed retail tenants\n• Central Valley dust exposure",
    )

    raw = _raw_lead(property_type="gas_station")
    enriched = enrich_lead(raw, mock_fc, settings)

    mock_generate.assert_called_once()
    assert "Reedley strip mall" in enriched.why_this_is_a_good_fit
    assert "Central Valley dust" in enriched.sales_talking_points
    assert enriched.source_tool.endswith("+ai_gateway_copy")


@patch("pallares_leads.enrich.sales_copy.generate_sales_copy")
@patch("pallares_leads.pipeline.run_market.FirecrawlClient")
def test_gateway_skips_rich_scrape_copy(mock_fc_cls: MagicMock, mock_generate: MagicMock) -> None:
    settings = Settings(
        firecrawl_api_key="test-key",
        ai_gateway_api_key="gw-key",
        ai_gateway_model="google/gemini-2.5-flash",
    )
    mock_fc = mock_fc_cls.return_value
    mock_fc.scrape_lead.return_value = LeadInvestigationResult(
        contact_phone="(559) 447-6295",
        contact_role="Leasing Manager",
        property_manager="ABC Property Management",
        pitch_angle="Manning Avenue retail corridor with 19,000+ daily cars in Reedley.",
        sales_talking_points="• Save Mart anchor in Reedley\n• 631-space parking lot",
    )
    mock_fc.search_contact_gap.return_value = None
    mock_fc.pick_broker_pdf_url.return_value = None
    mock_fc.last_map_info = {"cached": False, "urls": []}

    raw = _raw_lead(property_type="shopping_center")
    enrich_lead(raw, mock_fc, settings)

    mock_generate.assert_not_called()

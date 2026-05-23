from __future__ import annotations

from unittest.mock import MagicMock, patch

from pallares_leads.enrich.sales_copy import (
    SalesCopyResult,
    build_research_context,
    gateway_configured,
    is_generic_copy,
    maybe_enrich_sales_copy,
    needs_sales_copy,
)
from pallares_leads.schemas import EnrichedLead, RawLead
from pallares_leads.settings import Settings


def _raw_lead(**overrides) -> RawLead:
    base = {
        "place_id": "ChIJtest",
        "business_name": "Save Mart",
        "formatted_address": "100 Main St, Reedley, CA 93654",
        "city": "Reedley",
        "state": "CA",
        "property_type": "grocery",
        "lead_category": "Grocery",
        "website": "https://example.com",
        "google_maps_url": "https://maps.google.com/?cid=1",
        "main_phone": "(559) 638-0100",
    }
    base.update(overrides)
    return RawLead(**base)


def test_gateway_configured_requires_key_and_model() -> None:
    assert gateway_configured(
        Settings(ai_gateway_api_key="key", ai_gateway_model="google/gemini-2.5-flash")
    )
    assert not gateway_configured(Settings(ai_gateway_api_key="key", ai_gateway_model=""))
    assert not gateway_configured(
        Settings(ai_gateway_api_key="", ai_gateway_model="google/gemini-2.5-flash")
    )


def test_maybe_enrich_sales_copy_skips_without_gateway() -> None:
    raw = _raw_lead()
    enriched = EnrichedLead.model_validate(raw.model_dump())
    result = maybe_enrich_sales_copy(
        enriched,
        raw,
        None,
        [],
        Settings(ai_gateway_api_key="", ai_gateway_model=""),
    )
    assert result.why_this_is_a_good_fit == ""


@patch("pallares_leads.enrich.sales_copy.generate_sales_copy")
def test_maybe_enrich_sales_copy_writes_fields(mock_generate: MagicMock) -> None:
    settings = Settings(
        ai_gateway_api_key="gw-key",
        ai_gateway_model="google/gemini-2.5-flash",
    )
    raw = _raw_lead()
    enriched = EnrichedLead.model_validate(raw.model_dump())
    enriched.source_tool = "google_places+firecrawl_scrape"
    mock_generate.return_value = SalesCopyResult(
        why_call="Reedley grocery with parking-lot frontage.",
        talking_points="• Manning Ave visibility",
    )

    result = maybe_enrich_sales_copy(enriched, raw, None, ["631 spaces"], settings)

    assert result.why_this_is_a_good_fit.startswith("Reedley grocery")
    assert "Manning Ave" in result.sales_talking_points
    assert result.source_tool.endswith("+ai_gateway_copy")
    context = mock_generate.call_args.args[0]
    assert context["pdf_snippets"] == ["631 spaces"]


def test_build_research_context_merges_evidence_urls() -> None:
    raw = _raw_lead()
    enriched = EnrichedLead.model_validate(raw.model_dump())
    enriched.evidence_urls = ["https://example.com/contact"]
    from pallares_leads.enrich.schema import LeadInvestigationResult

    context = build_research_context(
        enriched,
        raw,
        LeadInvestigationResult(source_urls=["https://loopnet.com/listing.pdf"]),
        [],
    )
    assert "https://loopnet.com/listing.pdf" in context["evidence_urls"]

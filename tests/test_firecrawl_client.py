from __future__ import annotations

from unittest.mock import MagicMock, patch

from pallares_leads.enrich.firecrawl_client import FirecrawlClient
from pallares_leads.enrich.sales_copy import (
    SalesCopyResult,
    generate_sales_copy,
    is_generic_copy,
    needs_sales_copy,
)
from pallares_leads.schemas import EnrichedLead, RawLead
from pallares_leads.settings import Settings


def _raw_lead(**overrides) -> RawLead:
    base = {
        "place_id": "ChIJtest",
        "business_name": "Test Store",
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


def test_parse_map_links_handles_string_list() -> None:
    links = FirecrawlClient._parse_map_links(
        {"links": ["https://example.com/contact", "https://example.com/about"]}
    )
    assert links == ["https://example.com/contact", "https://example.com/about"]


def test_best_json_target_prefers_contact_page() -> None:
    mapped = [
        "https://example.com/blog/post-1",
        "https://example.com/contact-us",
        "https://example.com/about",
    ]
    target = FirecrawlClient._best_json_target("https://example.com", mapped)
    assert target == "https://example.com/contact-us"


def test_pick_broker_pdf_url_prefers_broker_domains() -> None:
    urls = [
        "https://example.com/menu.pdf",
        "https://images1.showcase.com/brochure.pdf",
    ]
    assert FirecrawlClient.pick_broker_pdf_url(urls) == "https://images1.showcase.com/brochure.pdf"


def test_map_cache_reuses_results() -> None:
    settings = Settings(firecrawl_api_key="test-key")
    fc = FirecrawlClient(settings)
    fc._map_cache["https://example.com"] = ["https://example.com/contact"]

    with patch("pallares_leads.enrich.firecrawl_client.httpx.Client") as mock_client_cls:
        links = fc.map_contact_urls("https://example.com/contact-us", limit=5)

    assert links == ["https://example.com/contact"]
    mock_client_cls.assert_not_called()


@patch("pallares_leads.enrich.firecrawl_client.httpx.Client")
def test_scrape_lead_uses_map_then_json(mock_client_cls: MagicMock) -> None:
    settings = Settings(firecrawl_api_key="test-key")
    client = mock_client_cls.return_value.__enter__.return_value

    map_response = MagicMock()
    map_response.status_code = 200
    map_response.json.return_value = {
        "links": ["https://example.com/contact", "https://example.com/menu"],
    }

    scrape_response = MagicMock()
    scrape_response.status_code = 200
    scrape_response.json.return_value = {
        "success": True,
        "data": {
            "markdown": "Call us at (559) 638-3333 for catering.",
            "json": {
                "contact_phone": "(559) 638-3333",
                "exterior_signals": "parking lot",
            },
        },
    }

    client.post.side_effect = [map_response, scrape_response]

    fc = FirecrawlClient(settings)
    result = fc.scrape_lead(_raw_lead())

    assert result is not None
    assert result.contact_phone == "(559) 638-3333"
    assert client.post.call_count == 2
    json_call = client.post.call_args_list[1].kwargs["json"]
    assert json_call["url"] == "https://example.com/contact"
    assert json_call["formats"] == ["markdown", "json"]
    assert json_call["jsonOptions"]["schema"]["properties"]["contact_phone"]


@patch("pallares_leads.enrich.firecrawl_client.httpx.Client")
def test_scrape_site_runs_markdown_scrapes_in_parallel(mock_client_cls: MagicMock) -> None:
    settings = Settings(firecrawl_api_key="test-key", firecrawl_max_concurrency=5)
    fc = FirecrawlClient(settings)
    fc._map_cache["https://example.com"] = [
        "https://example.com",
        "https://example.com/contact",
        "https://example.com/about",
    ]

    call_count = {"n": 0}

    def fake_scrape(url: str) -> str | None:
        call_count["n"] += 1
        return f"content for {url}"

    with patch.object(fc, "scrape_url", side_effect=fake_scrape) as mock_scrape:
        pages = fc.scrape_site("https://example.com", max_pages=3)

    assert len(pages) == 3
    assert call_count["n"] == 3
    assert mock_scrape.call_count == 3


@patch("pallares_leads.enrich.firecrawl_client.httpx.Client")
def test_scrape_pdf_snippet_uses_pdf_parser(mock_client_cls: MagicMock) -> None:
    settings = Settings(firecrawl_api_key="test-key")
    client = mock_client_cls.return_value.__enter__.return_value
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = {"data": {"markdown": "# Broker Flyer\n631 parking spaces"}}
    client.post.return_value = response

    fc = FirecrawlClient(settings)
    snippet = fc.scrape_pdf_snippet("https://images1.showcase.com/brochure.pdf")

    assert snippet is not None
    assert "631 parking" in snippet
    body = client.post.call_args.kwargs["json"]
    assert body["parsers"] == [{"type": "pdf", "mode": "auto", "maxPages": 15}]


@patch("pallares_leads.enrich.ai_gateway_client.httpx.Client")
def test_generate_sales_copy_calls_gateway(mock_client_cls: MagicMock) -> None:
    settings = Settings(
        ai_gateway_api_key="gw-key",
        ai_gateway_model="google/gemini-2.5-flash",
        ai_gateway_min_interval_s=0.0,
    )
    client = mock_client_cls.return_value.__enter__.return_value
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = {
        "choices": [
            {
                "message": {
                    "content": (
                        '{"why_call":"Reedley grocery with heavy lot exposure.",'
                        '"talking_points":"• Downtown Reedley anchor"}'
                    )
                }
            }
        ]
    }
    client.post.return_value = response

    result = generate_sales_copy({"business_name": "Save Mart", "city": "Reedley"}, settings)

    assert isinstance(result, SalesCopyResult)
    assert "Reedley grocery" in result.why_call
    posted = client.post.call_args
    assert posted.args[0] == "https://ai-gateway.vercel.sh/v1/chat/completions"
    assert posted.kwargs["json"]["model"] == "google/gemini-2.5-flash"


def test_needs_sales_copy_false_when_specific() -> None:
    lead = EnrichedLead.model_validate(_raw_lead().model_dump())
    lead.why_this_is_a_good_fit = (
        "Reedley Save Mart on Manning Ave with visible storefront signage."
    )
    lead.sales_talking_points = "• Grocery anchor for Reedley families"
    assert needs_sales_copy(lead) is False
    assert (
        is_generic_copy(lead.why_this_is_a_good_fit, lead.sales_talking_points, city="Reedley")
        is False
    )

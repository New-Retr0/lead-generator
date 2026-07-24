from __future__ import annotations

from unittest.mock import MagicMock, patch

from pallares_leads.enrich.firecrawl_client import _SHARED_MAP_CACHE, FirecrawlClient
from pallares_leads.schemas import RawLead
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
    # Broker-OWN-domain flyers are preferred; listing aggregators are no longer hints.
    urls = [
        "https://example.com/menu.pdf",
        "https://pearsonrealty.com/brochure.pdf",
    ]
    assert FirecrawlClient.pick_broker_pdf_url(urls) == "https://pearsonrealty.com/brochure.pdf"


def test_map_cache_reuses_results() -> None:

    _SHARED_MAP_CACHE.clear()
    settings = Settings(firecrawl_api_key="test-key")
    fc = FirecrawlClient(settings)
    _SHARED_MAP_CACHE["https://example.com"] = ["https://example.com/contact"]

    with patch.object(FirecrawlClient, "_sdk_call_with_retry") as mock_sdk:
        links = fc.map_contact_urls("https://example.com/contact-us", limit=5)

    assert links == ["https://example.com/contact"]
    mock_sdk.assert_not_called()
    _SHARED_MAP_CACHE.clear()


@patch.object(FirecrawlClient, "_scrape_json")
@patch.object(FirecrawlClient, "_sdk_call_with_retry")
def test_scrape_lead_uses_homepage_then_json(mock_sdk, mock_scrape_json) -> None:
    settings = Settings(firecrawl_api_key="test-key")
    raw = _raw_lead()

    homepage = MagicMock()
    homepage.markdown = "Call us at (559) 638-3333."
    homepage.links = ["https://example.com/contact", "https://example.com/menu"]

    from pallares_leads.enrich.schema import LeadInvestigationResult

    mock_scrape_json.return_value = LeadInvestigationResult(
        contact_phone="(559) 638-3333",
        exterior_signals="parking lot",
    )
    mock_sdk.return_value = homepage

    fc = FirecrawlClient(settings)
    result = fc.scrape_lead(raw)

    assert result is not None
    assert result.contact_phone == "(559) 638-3333"
    mock_scrape_json.assert_called_once()


def test_scrape_site_runs_markdown_scrapes_in_parallel() -> None:
    from pallares_leads.enrich import firecrawl_client as fc_mod

    settings = Settings(firecrawl_api_key="test-key")
    fc = FirecrawlClient(settings)
    fc._plan_max_concurrency = 50
    with fc_mod._MAP_CACHE_LOCK:
        fc_mod._SHARED_MAP_CACHE["https://example.com"] = [
            "https://example.com",
            "https://example.com/contact",
            "https://example.com/about",
        ]

    call_count = {"n": 0}

    def fake_scrape(url: str, *, formats=None) -> str | None:
        call_count["n"] += 1
        return f"content for {url}"

    with patch.object(fc, "scrape_url", side_effect=fake_scrape) as mock_scrape:
        pages = fc.scrape_site("https://example.com", max_pages=3)

    assert len(pages) == 3
    assert call_count["n"] == 3
    assert mock_scrape.call_count == 3
    fc_mod._SHARED_MAP_CACHE.clear()


def test_effective_max_concurrency_uses_plan() -> None:
    settings = Settings(firecrawl_api_key="test-key")
    fc = FirecrawlClient(settings)
    fc._plan_max_concurrency = 50
    assert fc.effective_max_concurrency() == 50

    fc._resolved_concurrency = None
    fc._plan_max_concurrency = None
    assert fc.effective_max_concurrency() == 50


def test_effective_parallel_workers_from_plan_concurrency() -> None:
    settings = Settings(firecrawl_api_key="test-key")
    fc = FirecrawlClient(settings)

    fc._resolved_concurrency = 5
    assert fc.effective_parallel_workers() == 2

    fc._resolved_concurrency = 50
    assert fc.effective_parallel_workers() == 25

    fc._resolved_concurrency = 100
    assert fc.effective_parallel_workers() == 50

    fc._resolved_concurrency = 2
    assert fc.effective_parallel_workers() == 1


def test_refresh_plan_limits_resizes_from_live_queue_status() -> None:
    settings = Settings(firecrawl_api_key="test-key")
    fc = FirecrawlClient(settings)
    fc._plan_max_concurrency = 50
    fc._resolved_concurrency = 50
    assert fc.effective_parallel_workers() == 25

    with (
        patch.object(
            fc,
            "get_queue_status",
            return_value={"maxConcurrency": 100},
        ) as queue_mock,
        patch.object(
            fc,
            "get_team_credit_usage",
            return_value={"planCredits": 500_000, "remainingCredits": 400_000},
        ),
    ):
        info = fc.refresh_plan_limits()

    queue_mock.assert_called_once()
    assert info["max_concurrency"] == 100
    assert info["place_workers"] == 50
    assert fc.effective_parallel_workers() == 50


def test_rate_limit_throttle_is_temporary() -> None:
    settings = Settings(firecrawl_api_key="test-key")
    fc = FirecrawlClient(settings)
    fc._plan_max_concurrency = 50
    fc._resolved_concurrency = None
    for _ in range(5):
        fc.note_rate_limit()
    assert fc.effective_max_concurrency() == 25
    fc.note_rate_limit_recovered()
    assert fc.effective_max_concurrency() == 50


def test_agent_finished_detects_timeout_poll_payload() -> None:
    assert FirecrawlClient._agent_finished(type("R", (), {"status": "completed"})()) is True
    assert FirecrawlClient._agent_finished(type("R", (), {"status": "scraping"})()) is False
    assert FirecrawlClient._agent_finished({"status": "processing"}) is False
    assert FirecrawlClient._agent_finished({"data": {"owner_name": "Acme"}}) is True


@patch("pallares_leads.enrich.firecrawl_client.Firecrawl")
def test_sdk_constructed_with_http_timeout(mock_sdk: MagicMock) -> None:
    """SDK default timeout=None hangs forever on stalled sockets — we must set one."""
    settings = Settings(firecrawl_api_key="test-key", firecrawl_timeout_ms=30_000)
    FirecrawlClient(settings)
    assert mock_sdk.call_args.kwargs["timeout"] == 45.0


@patch("pallares_leads.enrich.firecrawl_client.Firecrawl")
def test_batch_scrape_passes_wait_timeout(mock_sdk_cls: MagicMock) -> None:
    """batch_scrape wait_timeout=None polls forever — must pass a wall-clock cap."""
    settings = Settings(
        firecrawl_api_key="test-key",
        firecrawl_timeout_ms=30_000,
        enrichment_lead_timeout_s=600,
    )
    sdk = mock_sdk_cls.return_value
    sdk.batch_scrape.return_value = type("R", (), {"data": []})()
    fc = FirecrawlClient(settings)
    fc.batch_scrape_urls(["https://a.example/contact", "https://a.example/about"])
    assert sdk.batch_scrape.called
    assert sdk.batch_scrape.call_args.kwargs["wait_timeout"] == 120


def test_settings_hang_timeout_defaults() -> None:
    settings = Settings(firecrawl_api_key="test-key")
    assert settings.firecrawl_agent_timeout_s == 180
    assert settings.enrichment_lead_timeout_s == 600


@patch("pallares_leads.enrich.firecrawl_client.Firecrawl")
def test_incomplete_agent_is_cancelled(mock_sdk_cls: MagicMock) -> None:
    settings = Settings(firecrawl_api_key="test-key", firecrawl_agent_timeout_s=180)
    sdk = mock_sdk_cls.return_value
    sdk.agent.return_value = type("R", (), {"id": "agent-1", "status": "processing", "data": None})()
    fc = FirecrawlClient(settings)
    assert fc.run_capped_agent(_raw_lead()) is None
    sdk.cancel_agent.assert_called_once_with("agent-1")


def test_normalize_team_credit_usage_marks_extra_credits() -> None:
    payload = FirecrawlClient.normalize_team_credit_usage(
        {
            "data": {
                "remainingCredits": 120_000,
                "planCredits": 100_000,
                "billingPeriodEnd": "2026-08-01T00:00:00.000Z",
            }
        }
    )
    assert payload["usedCredits"] == 0
    assert payload["extraCredits"] == 20_000


@patch("pallares_leads.enrich.firecrawl_client.httpx.Client")
def test_scrape_pdf_snippet_uses_pdf_parser(mock_client_cls: MagicMock) -> None:
    settings = Settings(firecrawl_api_key="test-key")
    client = mock_client_cls.return_value.__enter__.return_value
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = {"data": {"markdown": "# Broker Flyer\n631 parking spaces"}}
    client.post.return_value = response

    fc = FirecrawlClient(settings)
    snippet = fc.scrape_pdf_snippet("https://pearsonrealty.com/brochure.pdf")

    assert snippet is not None
    assert "631 parking" in snippet
    body = client.post.call_args.kwargs["json"]
    assert body["parsers"] == [{"type": "pdf", "mode": "auto", "maxPages": 15}]


@patch("pallares_leads.enrich.firecrawl_client.httpx.Client")
def test_scrape_pdf_snippet_blocks_listing_aggregators(mock_client_cls: MagicMock) -> None:
    # LoopNet/CoStar/Crexi/Showcase are never fetched (ToS-barred) — no HTTP call at all.
    settings = Settings(firecrawl_api_key="test-key")
    client = mock_client_cls.return_value.__enter__.return_value
    fc = FirecrawlClient(settings)
    assert fc.scrape_pdf_snippet("https://images1.showcase.com/brochure.pdf") is None
    assert fc.scrape_pdf_snippet("https://www.loopnet.com/a/flyer.pdf") is None
    client.post.assert_not_called()

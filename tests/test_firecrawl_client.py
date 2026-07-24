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


@patch("pallares_leads.enrich.firecrawl_client.Firecrawl")
def test_scrape_pdf_snippet_uses_pdf_parser(mock_sdk_cls: MagicMock) -> None:
    from firecrawl.v2.types import PDFParser

    settings = Settings(firecrawl_api_key="test-key")
    sdk = mock_sdk_cls.return_value
    sdk.scrape.return_value = type("D", (), {"markdown": "# Broker Flyer\n631 parking spaces"})()
    fc = FirecrawlClient(settings)
    snippet = fc.scrape_pdf_snippet("https://pearsonrealty.com/brochure.pdf")
    assert snippet is not None
    assert "631 parking" in snippet
    kwargs = sdk.scrape.call_args.kwargs
    assert kwargs.get("proxy") == "basic"
    parsers = kwargs.get("parsers") or []
    assert len(parsers) == 1
    assert isinstance(parsers[0], PDFParser)
    assert parsers[0].max_pages == 15


def test_scrape_pdf_snippet_blocks_listing_aggregators() -> None:
    # LoopNet/CoStar/Crexi/Showcase are never fetched (ToS-barred) — no SDK call at all.
    settings = Settings(firecrawl_api_key="test-key")
    fc = FirecrawlClient(settings)
    with patch.object(fc, "_sdk_call_with_retry") as mock_sdk:
        assert fc.scrape_pdf_snippet("https://images1.showcase.com/brochure.pdf") is None
        assert fc.scrape_pdf_snippet("https://www.loopnet.com/a/flyer.pdf") is None
        mock_sdk.assert_not_called()


def test_scrape_kwargs_pins_basic_proxy() -> None:
    settings = Settings(firecrawl_api_key="test-key")
    fc = FirecrawlClient(settings)
    kwargs = fc._scrape_kwargs()
    assert kwargs["proxy"] == "basic"
    assert kwargs["block_ads"] is True
    assert fc._scrape_kwargs(proxy="auto")["proxy"] == "auto"


@patch.object(FirecrawlClient, "_scrape_json")
@patch.object(FirecrawlClient, "map_contact_urls")
@patch.object(FirecrawlClient, "_sdk_call_with_retry")
def test_scrape_lead_tries_homepage_json_before_map(
    mock_sdk, mock_map, mock_scrape_json
) -> None:
    from pallares_leads.enrich.schema import LeadInvestigationResult

    settings = Settings(firecrawl_api_key="test-key")
    raw = _raw_lead()
    homepage = MagicMock()
    homepage.markdown = "Welcome to our store."
    homepage.links = ["https://example.com/menu"]  # no contact hints
    mock_sdk.return_value = homepage
    mock_scrape_json.return_value = LeadInvestigationResult(contact_phone="(559) 638-3333")

    fc = FirecrawlClient(settings)
    _SHARED_MAP_CACHE.clear()
    result = fc.scrape_lead(raw)

    assert result is not None
    mock_scrape_json.assert_called_once_with("https://example.com", raw)
    mock_map.assert_not_called()
    _SHARED_MAP_CACHE.clear()


def test_capture_scrape_meta_records_proxy_and_cache() -> None:
    settings = Settings(firecrawl_api_key="test-key")
    fc = FirecrawlClient(settings)
    fc._capture_scrape_meta(
        {"data": {"metadata": {"proxyUsed": "basic", "cacheState": "hit", "creditsUsed": 1}}}
    )
    assert fc._pending_credit_meta["proxy_used"] == "basic"
    assert fc._pending_credit_meta["cache_state"] == "hit"


def test_can_afford_skips_when_remaining_below_budget() -> None:
    settings = Settings(firecrawl_api_key="test-key", firecrawl_agent_max_credits=10)
    fc = FirecrawlClient(settings)
    assert fc.can_afford(10) is True  # unknown remaining → do not block
    fc._remember_team_remaining(5)
    assert fc.can_afford(10) is False
    assert fc.can_afford(5) is True
    fc._debit_team_remaining(3)
    assert fc.can_afford(5) is False
    assert fc.run_capped_agent(_raw_lead()) is None


@patch("pallares_leads.enrich.firecrawl_client.Firecrawl")
def test_owner_chain_agent_uses_settings_credit_budget(mock_sdk_cls: MagicMock) -> None:
    settings = Settings(
        firecrawl_api_key="test-key",
        firecrawl_agent_max_credits=10,
        firecrawl_agent_model="spark-1-mini",
    )
    sdk = mock_sdk_cls.return_value
    sdk.agent.return_value = type(
        "R", (), {"id": "a1", "status": "completed", "data": {"owner_name": "Acme LLC"}}
    )()
    fc = FirecrawlClient(settings)
    fc._remember_team_remaining(50)
    data = fc.run_owner_chain_agent(
        entity_name="Acme LLC",
        party_name="Acme",
        address="1 Main",
        city="Reedley",
        state_name="California",
        sos_url="https://example.com/sos",
    )
    assert data == {"owner_name": "Acme LLC"}
    assert sdk.agent.call_args.kwargs["max_credits"] == 10
    assert sdk.agent.call_args.kwargs["model"] == "spark-1-mini"

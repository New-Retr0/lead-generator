from __future__ import annotations

from pallares_leads.enrich.firecrawl_client import (
    BROKER_PDF_HINTS,
    PROHIBITED_FETCH_HOSTS,
    is_prohibited_fetch_host,
)


def test_aggregator_hosts_are_prohibited() -> None:
    for url in (
        "https://www.loopnet.com/Listing/123",
        "https://gateway.costar.com/flyer.pdf",
        "https://www.crexi.com/properties/abc",
        "https://images.showcase.com/x.pdf",
        "HTTPS://WWW.LOOPNET.COM/UP",  # case-insensitive
    ):
        assert is_prohibited_fetch_host(url) is True, url


def test_broker_own_domain_and_others_allowed() -> None:
    for url in (
        "https://pearsonrealty.com/flyer.pdf",
        "https://acmeproperties.com/leasing.pdf",
        "https://example.com/team",
        None,
        "",
    ):
        assert is_prohibited_fetch_host(url) is False, url


def test_broker_pdf_hints_exclude_aggregators() -> None:
    # The listing aggregators must not be preferentially selected as broker PDFs.
    for banned in ("loopnet", "costar", "crexi", "showcase"):
        assert banned not in BROKER_PDF_HINTS
    # And the prohibited set covers exactly the aggregator platforms.
    assert "loopnet.com" in PROHIBITED_FETCH_HOSTS
    assert "costar.com" in PROHIBITED_FETCH_HOSTS

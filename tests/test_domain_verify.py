from unittest.mock import MagicMock, patch

from pallares_leads.enrich.domain_verify import (
    dns_resolves,
    pick_verified_website_url,
    scrub_unverified_website,
    verify_website_url,
)
from pallares_leads.schemas import EnrichedLead


def test_dns_resolves_known_host() -> None:
    assert dns_resolves("google.com") is True


def test_dns_resolves_fake_shop_domain() -> None:
    assert dns_resolves("reedleywellnesscenter.shop") is False


@patch("pallares_leads.enrich.domain_verify.httpx.Client")
def test_verify_rejects_nxdomain(mock_client_cls: MagicMock) -> None:
    assert verify_website_url("https://reedleywellnesscenter.shop") is False
    mock_client_cls.assert_not_called()


@patch(
    "pallares_leads.enrich.domain_verify.verify_website_url",
    side_effect=lambda url, **_: ".shop" not in url,
)
def test_pick_verified_skips_bad_guesses(_mock_verify: MagicMock) -> None:
    picked = pick_verified_website_url(
        [
            "https://reedleywellnesscenter.shop",
            "https://superburger.us",
        ],
        "Reedley Wellness Center",
    )
    assert picked == "https://superburger.us"


@patch("pallares_leads.enrich.domain_verify.verify_website_url", return_value=True)
def test_scrub_clears_stale_failure_note_when_site_ok(_mock_verify: MagicMock) -> None:
    lead = EnrichedLead(
        place_id="x",
        business_name="559 PMC",
        formatted_address="1 Main",
        city="Fresno",
        state="CA",
        property_type="property_manager",
        lead_category="Commercial Property Manager",
        website="https://559pmc.com",
        notes="Website failed domain verification — needs manual lookup",
    )
    scrub_unverified_website(lead)
    assert lead.website == "https://559pmc.com"
    assert lead.notes == ""


@patch("pallares_leads.enrich.domain_verify.verify_website_url", return_value=False)
def test_scrub_clears_bad_website(_mock_verify: MagicMock) -> None:
    lead = EnrichedLead(
        place_id="x",
        business_name="Test",
        formatted_address="1 Main",
        city="Reedley",
        state="CA",
        property_type="medical_plaza",
        lead_category="Medical Plaza",
        website="https://reedleywellnesscenter.shop",
        evidence_urls=["https://reedleywellnesscenter.shop/contact"],
    )
    scrub_unverified_website(lead)
    assert lead.website is None
    assert "failed domain verification" in lead.notes

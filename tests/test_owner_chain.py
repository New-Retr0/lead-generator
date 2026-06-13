from __future__ import annotations

from unittest.mock import MagicMock

from pallares_leads.config_loader import load_jurisdictions
from pallares_leads.db.store import LeadStore
from pallares_leads.enrich.browser_use_client import (
    BrowserUseClient,
    LoopNetBroker,
    LoopNetResult,
    OfficerRecord,
    SosEntityResult,
)
from pallares_leads.enrich.contact_requirements import get_enrichment_rules
from pallares_leads.enrich.owner_chain import resolve_owner_chain
from pallares_leads.enrich.task_templates import CA_BIZFILE_TASK, render_task
from pallares_leads.schemas import NOT_FOUND, EnrichedLead, RawLead
from pallares_leads.settings import Settings


def _raw_lead(**overrides) -> RawLead:
    base = {
        "place_id": "ChIJmall",
        "business_name": "Reedley Plaza LLC",
        "formatted_address": "100 Manning Ave, Reedley, CA 93654",
        "city": "Reedley",
        "state": "CA",
        "property_type": "strip_mall",
        "lead_category": "Strip Mall / Retail Plaza",
        "website": "https://example-mall.com",
        "market_key": "reedley",
    }
    base.update(overrides)
    return RawLead(**base)


def test_render_task_replaces_placeholders() -> None:
    rendered = render_task(CA_BIZFILE_TASK, entity_name="REEDLEY PLAZA LLC")
    assert "@{{entity_name}}" not in rendered
    assert "REEDLEY PLAZA LLC" in rendered
    assert "bizfileonline.sos.ca.gov" in rendered


def test_browser_use_client_skips_without_api_key() -> None:
    settings = Settings(browser_use_enabled=True, browser_use_api_key="")
    client = BrowserUseClient(settings)
    assert client.is_available() is False
    assert "missing" in client.last_skip_reason.lower()


def test_browser_use_health_check_missing_key() -> None:
    settings = Settings(browser_use_enabled=True, browser_use_api_key="")
    client = BrowserUseClient(settings)
    ok, msg = client.health_check()
    assert ok is False
    assert "missing" in msg.lower()


def test_load_jurisdictions_has_ca_counties() -> None:
    settings = Settings()
    registry = load_jurisdictions(settings.config_dir)
    assert "ca" in registry.states
    assert "fresno_ca" in registry.counties
    assert registry.counties["fresno_ca"].parcel_portal is not None
    assert registry.counties["fresno_ca"].parcel_portal.owner_names_online is False


def test_owner_chain_applies_sos_contacts(tmp_path) -> None:
    settings = Settings(
        browser_use_enabled=True,
        browser_use_api_key="test-key",
        config_dir=Settings().config_dir,
    )
    store = LeadStore(tmp_path / "test.db")
    raw = _raw_lead()
    enriched = EnrichedLead.model_validate(raw.model_dump())
    enriched.best_contact_phone = NOT_FOUND
    rules = get_enrichment_rules("strip_mall", settings.config_dir)

    mock_browser = MagicMock(spec=BrowserUseClient)
    mock_browser.is_available.return_value = True
    mock_browser.total_cost_usd = 0.25
    mock_browser.last_skip_reason = ""
    mock_browser.sos_entity_lookup.return_value = SosEntityResult(
        entity_name="Reedley Plaza LLC",
        entity_number="1234567",
        registered_agent="CT Corporation System",
        officers=[OfficerRecord(name="Jane Owner", title="Manager")],
    )
    mock_browser.recorder_party_search.return_value = None
    mock_browser.parcel_owner_lookup.return_value = None
    mock_browser.loopnet_listing_lookup.return_value = None

    result = resolve_owner_chain(
        raw,
        enriched,
        rules,
        settings=settings,
        store=store,
        browser=mock_browser,
    )

    assert result.ran is True
    assert result.enriched.best_contact_name == "Jane Owner"
    assert "owner_chain" in result.enriched.source_tool
    record = store.get_owner_record(raw.place_id)
    assert record is not None
    assert record["owner_name"] == "Reedley Plaza LLC"
    store.close()


def test_owner_chain_reuses_entity_record(tmp_path) -> None:
    settings = Settings(
        browser_use_enabled=True,
        browser_use_api_key="test-key",
        config_dir=Settings().config_dir,
    )
    store = LeadStore(tmp_path / "test.db")
    raw = _raw_lead(place_id="ChIJother")
    enriched = EnrichedLead.model_validate(raw.model_dump())
    enriched.best_contact_phone = NOT_FOUND
    rules = get_enrichment_rules("strip_mall", settings.config_dir)

    store.upsert_owner_record(
        place_id="ChIJseed",
        owner_name="Reedley Plaza LLC",
        registered_agent="CT Corporation System",
        principals_json=[{"name": "Jane Owner", "title": "Manager"}],
        source="owner_chain:sos",
    )

    mock_browser = MagicMock(spec=BrowserUseClient)
    mock_browser.is_available.return_value = True

    result = resolve_owner_chain(
        raw,
        enriched,
        rules,
        settings=settings,
        store=store,
        browser=mock_browser,
    )

    mock_browser.sos_entity_lookup.assert_not_called()
    assert result.contact_improved or result.enriched.best_contact_name == "Jane Owner"
    store.close()


def test_owner_chain_skips_when_contact_bar_met() -> None:
    settings = Settings(browser_use_enabled=True, browser_use_api_key="test-key")
    raw = _raw_lead()
    enriched = EnrichedLead.model_validate(raw.model_dump())
    enriched.best_contact_phone = "(559) 638-1111"
    enriched.best_contact_role = "Property Manager"
    enriched.property_manager_or_ownership_clue = "ABC Property Management"
    rules = get_enrichment_rules("strip_mall", settings.config_dir)

    mock_browser = MagicMock(spec=BrowserUseClient)
    result = resolve_owner_chain(
        raw,
        enriched,
        rules,
        settings=settings,
        browser=mock_browser,
    )

    assert result.ran is False
    mock_browser.sos_entity_lookup.assert_not_called()


def test_owner_chain_loopnet_broker_contact(tmp_path) -> None:
    settings = Settings(
        browser_use_enabled=True,
        browser_use_api_key="test-key",
        config_dir=Settings().config_dir,
    )
    store = LeadStore(tmp_path / "test.db")
    raw = _raw_lead(business_name="Downtown Parking Lot", property_type="parking")
    enriched = EnrichedLead.model_validate(raw.model_dump())
    enriched.best_contact_phone = NOT_FOUND
    rules = get_enrichment_rules("parking", settings.config_dir)

    mock_browser = MagicMock(spec=BrowserUseClient)
    mock_browser.is_available.return_value = True
    mock_browser.sos_entity_lookup.return_value = None
    mock_browser.recorder_party_search.return_value = None
    mock_browser.parcel_owner_lookup.return_value = None
    mock_browser.loopnet_listing_lookup.return_value = LoopNetResult(
        listing_url="https://www.loopnet.com/listing/1",
        listed_by=[LoopNetBroker(name="Sam Broker", company="CBRE", phone="(559) 555-0100")],
    )

    result = resolve_owner_chain(
        raw,
        enriched,
        rules,
        settings=settings,
        store=store,
        browser=mock_browser,
        loopnet_count=0,
    )

    assert result.loopnet_used is True
    assert result.enriched.best_contact_phone == "(559) 555-0100"
    assert result.enriched.best_contact_type == "cre broker"
    store.close()


def test_contact_hierarchy_prefers_property_owner_over_leasing() -> None:
    from pallares_leads.resolve.contact_hierarchy import pick_best_contact
    from pallares_leads.schemas import ExtractedContact

    contacts = [
        ExtractedContact(contact_type="leasing", name="Leasing Desk", phone="(559) 111-1111"),
        ExtractedContact(contact_type="property_owner", name="Jane Owner", phone="(559) 222-2222"),
    ]
    best = pick_best_contact(contacts, property_type="strip_mall")
    assert best is not None
    assert best.contact_type == "property_owner"

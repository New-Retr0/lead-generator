from __future__ import annotations

from unittest.mock import MagicMock, patch

from pallares_leads.config_loader import load_jurisdictions
from pallares_leads.db.store import LeadStore
from pallares_leads.enrich.contact_requirements import get_enrichment_rules
from pallares_leads.enrich.owner_chain import OwnerChainResult, resolve_owner_chain
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
    rendered = render_task(
        CA_BIZFILE_TASK,
        portal_url="https://bizfileonline.sos.ca.gov/search/business",
        entity_name="REEDLEY PLAZA LLC",
        state_name="California",
    )
    assert "@{{entity_name}}" not in rendered
    assert "REEDLEY PLAZA LLC" in rendered
    assert "bizfileonline.sos.ca.gov" in rendered


def test_load_jurisdictions_has_ca_counties() -> None:
    settings = Settings()
    registry = load_jurisdictions(settings.config_dir)
    assert "ca" in registry.states
    assert "hi" in registry.states
    assert "fresno_ca" in registry.counties
    assert "maricopa_az" in registry.counties
    assert registry.counties["fresno_ca"].parcel_portal is not None
    assert registry.counties["fresno_ca"].parcel_portal.owner_names_online is False


def test_owner_chain_requires_firecrawl_api_key() -> None:
    settings = Settings(firecrawl_api_key="", config_dir=Settings().config_dir)
    raw = _raw_lead()
    enriched = EnrichedLead.model_validate(raw.model_dump())
    enriched.best_contact_phone = NOT_FOUND
    rules = get_enrichment_rules("strip_mall", settings.config_dir)

    result = resolve_owner_chain(raw, enriched, rules, settings=settings)

    assert result.ran is False
    assert "FIRECRAWL_API_KEY" in result.reason


def test_owner_chain_applies_firecrawl_agent_contacts(store: LeadStore) -> None:
    from helpers import ensure_lead

    settings = Settings(
        firecrawl_api_key="fc_test",
        config_dir=Settings().config_dir,
    )
    raw = _raw_lead(place_id="ChIJ_sos_unique_test", business_name="Unique SOS Test Plaza LLC")
    ensure_lead(store, raw.place_id, business_name=raw.business_name)
    enriched = EnrichedLead.model_validate(raw.model_dump())
    enriched.best_contact_phone = NOT_FOUND
    rules = get_enrichment_rules("strip_mall", settings.config_dir)

    mock_fc = MagicMock()
    mock_fc.run_owner_chain_agent.return_value = {
        "entity_name": "Unique SOS Test Plaza LLC",
        "entity_number": "1234567",
        "registered_agent": "CT Corporation System",
        "officers": [{"name": "Jane Owner", "title": "Manager"}],
    }

    result = resolve_owner_chain(
        raw,
        enriched,
        rules,
        settings=settings,
        store=store,
        firecrawl=mock_fc,
    )

    assert result.ran is True
    assert any(c.name == "Jane Owner" for c in result.enriched.site_contacts)
    assert "owner_chain" in result.enriched.source_tool
    record = store.get_owner_record(raw.place_id)
    assert record is not None
    assert record["owner_name"] == "Unique SOS Test Plaza LLC"


def test_owner_chain_reuses_entity_record(store: LeadStore) -> None:
    from helpers import ensure_lead

    settings = Settings(
        firecrawl_api_key="fc_test",
        config_dir=Settings().config_dir,
    )
    raw = _raw_lead(place_id="ChIJother")
    ensure_lead(store, raw.place_id, business_name=raw.business_name)
    ensure_lead(store, "ChIJseed", business_name="Reedley Plaza LLC")
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

    mock_fc = MagicMock()
    result = resolve_owner_chain(
        raw,
        enriched,
        rules,
        settings=settings,
        store=store,
        firecrawl=mock_fc,
    )

    mock_fc.run_owner_chain_agent.assert_not_called()
    assert result.contact_improved or result.enriched.best_contact_name == "Jane Owner"


def test_owner_chain_skips_when_contact_bar_met() -> None:
    settings = Settings(firecrawl_api_key="fc_test")
    raw = _raw_lead()
    enriched = EnrichedLead.model_validate(raw.model_dump())
    enriched.best_contact_phone = "(559) 638-1111"
    enriched.best_contact_role = "Property Manager"
    enriched.property_manager_or_ownership_clue = "ABC Property Management"
    rules = get_enrichment_rules("strip_mall", settings.config_dir)

    mock_fc = MagicMock()
    result = resolve_owner_chain(
        raw,
        enriched,
        rules,
        settings=settings,
        firecrawl=mock_fc,
    )

    assert result.ran is False
    mock_fc.run_owner_chain_agent.assert_not_called()


def test_owner_chain_agent_broker_contact(store: LeadStore) -> None:
    from helpers import ensure_lead

    settings = Settings(
        firecrawl_api_key="fc_test",
        config_dir=Settings().config_dir,
    )
    raw = _raw_lead(
        place_id="ChIJ_broker_unique",
        business_name="Downtown Parking Lot",
        property_type="parking",
    )
    ensure_lead(store, raw.place_id, business_name=raw.business_name)
    enriched = EnrichedLead.model_validate(raw.model_dump())
    enriched.best_contact_phone = NOT_FOUND
    rules = get_enrichment_rules("parking", settings.config_dir)

    mock_fc = MagicMock()
    mock_fc.run_owner_chain_agent.return_value = {
        "broker_name": "Sam Broker",
        "broker_company": "CBRE",
        "broker_phone": "(559) 555-0100",
    }

    with patch(
        "pallares_leads.enrich.owner_chain._reuse_owner_record",
        return_value=OwnerChainResult(enriched=enriched, ran=False, reason=""),
    ):
        result = resolve_owner_chain(
            raw,
            enriched,
            rules,
            settings=settings,
            store=store,
            firecrawl=mock_fc,
        )

    assert result.ran is True
    assert result.enriched.best_contact_phone == "(559) 555-0100"
    assert result.enriched.best_contact_type == "cre broker"


def test_county_key_for_market_returns_none_without_county() -> None:
    from pallares_leads.enrich.owner_chain import _county_key_for_market

    settings = Settings()
    raw = _raw_lead(market_key="unknown_market")
    assert _county_key_for_market(raw, settings) is None


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

"""Contact fact mirroring keeps People / callable / evidence aligned."""

from pallares_leads.pipeline.run_market import _collect_contact_facts
from pallares_leads.schemas import EnrichedLead, LeadFact, RawLead, SiteContact


def _raw(**kwargs) -> RawLead:
    base = dict(
        place_id="pid",
        business_name="Test Co",
        formatted_address="1 Main, Fresno, CA",
        city="Fresno",
        state="CA",
        zip_code="93701",
        property_type="property_manager",
        lead_category="property_manager",
        market_key="fresno",
        main_phone="(559) 111-2222",
        google_maps_url="https://maps.google.com/?cid=1",
    )
    base.update(kwargs)
    return RawLead(**base)


def test_mirrors_bbb_person_when_bbb_stage_omitted_person_fact():
    enriched = EnrichedLead(
        **_raw().model_dump(),
        site_contacts=[
            SiteContact(
                label="President/Broker",
                name="Mr. Charles R LeLievre",
                phone="(559) 435-8266",
                source_url="https://www.bbb.org/us/ca/fresno/profile/example",
                verification="verified",
                quote="Charles R LeLievre, President",
            )
        ],
        facts=[
            LeadFact(
                fact_kind="phone",
                value={"phone": "(559) 111-2222", "label": "Main line"},
                source_kind="google_places",
                verification="verified",
            )
        ],
    )

    facts = _collect_contact_facts(enriched, _raw())
    kinds = {(f.fact_kind, (f.value.get("name") or f.value.get("phone") or "")) for f in facts}

    assert ("person", "Mr. Charles R LeLievre") in kinds
    assert ("phone", "(559) 435-8266") in kinds
    assert all(f.source_kind == "bbb" for f in facts if f.fact_kind == "person")


def test_named_contact_also_emits_phone_and_email_facts():
    enriched = EnrichedLead(
        **_raw(main_phone="").model_dump(),
        site_contacts=[
            SiteContact(
                label="Director of Marketing",
                name="Jim Dueck",
                phone="559.638.6933",
                email="jimdueck@palmvillage.com",
                source_url="https://www.palmvillage.com/contact",
                verification="verified",
            )
        ],
        facts=[],
    )

    facts = _collect_contact_facts(enriched, _raw(main_phone=""))
    by_kind = {f.fact_kind: f for f in facts}

    assert by_kind["person"].value["name"] == "Jim Dueck"
    assert by_kind["person"].value.get("email") == "jimdueck@palmvillage.com"
    assert by_kind["phone"].value["phone"] == "559.638.6933"
    assert by_kind["email"].value["email"] == "jimdueck@palmvillage.com"


def test_does_not_duplicate_existing_bbb_person_fact():
    enriched = EnrichedLead(
        **_raw(main_phone="").model_dump(),
        site_contacts=[
            SiteContact(
                label="President",
                name="Pat Rivera",
                source_url="https://www.bbb.org/profile/x",
                verification="verified",
            )
        ],
        facts=[
            LeadFact(
                fact_kind="person",
                value={"name": "Pat Rivera", "title": "President"},
                source_kind="bbb",
                source_url="https://www.bbb.org/profile/x",
                verification="verified",
            )
        ],
    )

    facts = _collect_contact_facts(enriched, _raw(main_phone=""))
    assert facts == []

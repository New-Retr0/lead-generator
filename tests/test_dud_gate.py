from __future__ import annotations

from pallares_leads.resolve.dud_gate import (
    DUD_CLOSED_TEMPORARILY,
    DUD_DEAD_SITE_NO_PHONE,
    discovery_dud_reason,
    terminal_dud_reason,
)
from pallares_leads.schemas import EnrichedLead, RawLead, SiteContact


def _raw(**kw: object) -> RawLead:
    base: dict[str, object] = dict(
        place_id="p1",
        business_name="Test Co",
        formatted_address="1 Main",
        city="Reedley",
        state="CA",
        property_type="strip_mall",
        lead_category="Strip Mall",
        market_key="reedley",
    )
    base.update(kw)
    return RawLead(**base)  # type: ignore[arg-type]


def _enriched(**kw: object) -> EnrichedLead:
    base: dict[str, object] = dict(
        place_id="p1",
        business_name="Test Co",
        formatted_address="1 Main",
        city="Reedley",
        state="CA",
        property_type="strip_mall",
        lead_category="Strip Mall",
    )
    base.update(kw)
    return EnrichedLead(**base)  # type: ignore[arg-type]


def test_discovery_dud_for_temporarily_closed() -> None:
    reason = discovery_dud_reason(_raw(business_status="CLOSED_TEMPORARILY"))
    assert reason == DUD_CLOSED_TEMPORARILY


def test_discovery_no_dud_for_operational_or_missing_status() -> None:
    assert discovery_dud_reason(_raw(business_status="OPERATIONAL")) is None
    assert discovery_dud_reason(_raw()) is None


def test_terminal_dud_only_when_unreachable() -> None:
    # Has a callable phone -> not a dud, regardless of website.
    with_phone = _enriched(main_phone="(559) 638-1234")
    assert terminal_dud_reason(with_phone, website_alive=False) is None

    # No phone but a live website -> still enrichable later, not a dud.
    no_phone_live_site = _enriched()
    assert terminal_dud_reason(no_phone_live_site, website_alive=True) is None

    # No phone AND dead/absent website -> genuinely unreachable -> dud.
    unreachable = _enriched()
    assert terminal_dud_reason(unreachable, website_alive=False) == DUD_DEAD_SITE_NO_PHONE


def test_terminal_dud_sees_site_contact_phone() -> None:
    lead = _enriched(site_contacts=[SiteContact(phone="(559) 638-1234", label="Main")])
    assert terminal_dud_reason(lead, website_alive=False) is None

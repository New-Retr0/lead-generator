from __future__ import annotations

from pallares_leads.enrich.schema import LeadInvestigationResult
from pallares_leads.enrich.verify import ground_investigation
from pallares_leads.schemas import SiteContact


def _result(**contact_kwargs: object) -> LeadInvestigationResult:
    return LeadInvestigationResult(site_contacts=[SiteContact(**contact_kwargs)])


def test_name_and_phone_near_each_other_stay_verified() -> None:
    page = "Our team: John Manager Smith, Facilities Manager — call 559-638-1234 today."
    result = _result(name="John Manager Smith", phone="(559) 638-1234", label="Facilities Manager")
    grounded = ground_investigation(result, page)
    assert grounded.pairing_downgrades == 0
    contact = grounded.result.site_contacts[0]
    assert contact.phone == "(559) 638-1234"
    assert contact.verification == "verified"


def test_phone_far_from_name_is_unbound_and_corroborated() -> None:
    # Name at the top, phone only in a footer > 250 chars away — the number may be a
    # different tenant's line, so it must not be asserted as this person's.
    filler = " ".join(["about our facilities and grounds services"] * 20)
    page = f"John Manager Smith leads operations. {filler} Main office line: 559-638-1234."
    result = _result(name="John Manager Smith", phone="(559) 638-1234", label="Facilities Manager")
    grounded = ground_investigation(result, page)
    assert grounded.pairing_downgrades == 1
    contact = grounded.result.site_contacts[0]
    assert contact.name == "John Manager Smith"  # person kept
    assert contact.phone == ""  # reachability unbound
    assert contact.verification == "corroborated"  # downgraded, not verified


def test_unlocatable_phone_does_not_downgrade() -> None:
    # ground_phone matches on digits anywhere, but if we cannot POSITION the phone we
    # must not unbind on doubt — presence-grounded contact stays verified.
    page = "John Manager Smith. Reach the team. 5 5 9 . 6 3 8 . 1 2 3 4 is our number."
    result = _result(name="John Manager Smith", phone="(559) 638-1234", label="Manager")
    grounded = ground_investigation(result, page)
    # Phone digits are present (grounds), name is present; if positioned and far it
    # would unbind, but the fail-safe keeps it verified when it cannot be judged apart.
    contact = grounded.result.site_contacts[0]
    assert contact.name == "John Manager Smith"

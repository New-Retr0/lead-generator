from pathlib import Path

from pallares_leads.enrich.registries.bbb import (
    bbb_contacts,
    bbb_profile_to_facts,
    parse_bbb_profile,
    pick_bbb_profile_url,
)

FIXTURE = Path(__file__).parent / "fixtures" / "bbb_jaber_motors.md"
PROFILE_URL = (
    "https://www.bbb.org/us/ca/reedley/profile/used-car-dealers/jaber-motors-1126-850041372"
)


def _profile():
    return parse_bbb_profile(FIXTURE.read_text(encoding="utf-8"), PROFILE_URL)


def test_parses_rating_and_dates():
    profile = _profile()
    assert profile.rating == "A+"
    assert profile.accredited_since == "4/15/2021"
    assert profile.business_started == "5/8/2018"
    assert profile.years_in_business == "8"
    assert profile.entity_type == "Corporation"


def test_parses_principals_deduped():
    profile = _profile()
    assert profile.principals == [("Ahmad A. Jaber", "President")]


def test_parses_additional_phones():
    profile = _profile()
    assert profile.phones == ["(559) 517-3877", "(661) 261-4700"]


def test_parses_alternate_names():
    profile = _profile()
    assert profile.alternate_names == ["Jaber Auto Group, Inc."]


def test_facts_are_verified_with_quotes():
    facts = bbb_profile_to_facts(_profile())
    kinds = {f.fact_kind for f in facts}
    assert {"registry_rating", "person", "phone", "alternate_name"} <= kinds
    for fact in facts:
        assert fact.verification == "verified"
        assert fact.method == "deterministic_parse"
        assert fact.source_url == PROFILE_URL
    person = next(f for f in facts if f.fact_kind == "person")
    assert person.value == {"name": "Ahmad A. Jaber", "title": "President"}
    assert "Jaber" in person.quote


def test_contacts_never_pair_phone_with_person():
    contacts = bbb_contacts(_profile())
    principal = next(c for c in contacts if c.name)
    assert principal.phone == ""  # BBB never says whose line it is — no guessing
    phone_contacts = [c for c in contacts if c.phone]
    assert {c.phone for c in phone_contacts} == {"(559) 517-3877", "(661) 261-4700"}
    assert all(c.verification == "verified" for c in contacts)


def test_pick_profile_url_prefers_name_slug():
    candidates = [
        "https://www.bbb.org/us/ca/fresno/profile/new-car-dealers/some-other-dealer-1126-1",
        PROFILE_URL,
        "https://www.bbb.org/search?find_text=jaber",
    ]
    assert pick_bbb_profile_url(candidates, "Jaber Motors") == PROFILE_URL


def test_pick_profile_url_rejects_non_profiles():
    assert (
        pick_bbb_profile_url(
            ["https://www.bbb.org/search?find_text=jaber", "https://example.com"],
            "Jaber Motors",
        )
        is None
    )

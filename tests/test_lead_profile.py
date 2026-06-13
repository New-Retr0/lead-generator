from __future__ import annotations

from pathlib import Path

import pytest

from pallares_leads.enrich.contact_requirements import (
    clear_enrichment_rules_cache,
    get_enrichment_rules,
)
from pallares_leads.enrich.lead_profile import (
    EnrichmentPlaybook,
    classify_lead,
    detect_brand,
    merge_playbooks,
    should_use_profile_fast_path,
    static_playbook_for,
)
from pallares_leads.schemas import RawLead


def _gas(
    *,
    name: str = "Shell",
    website: str | None = "https://find.shell.com/us/fuel/locator",
    phone: str | None = "(559) 638-1234",
    place_id: str = "places/shell-1",
) -> RawLead:
    return RawLead(
        place_id=place_id,
        business_name=name,
        formatted_address="123 Main",
        city="Reedley",
        state="CA",
        property_type="gas_station",
        lead_category="Gas Station",
        market_key="reedley",
        website=website,
        main_phone=phone,
    )


@pytest.fixture(autouse=True)
def _clear_rules_cache() -> None:
    clear_enrichment_rules_cache()


def test_detect_brand_shell_from_name_and_locator() -> None:
    assert detect_brand("Shell", "https://find.shell.com/locator") == "shell"
    assert detect_brand("Chevron Gas", None) == "chevron"


def test_classify_franchise_gas_station() -> None:
    profile = classify_lead(_gas())
    assert profile.key == "gas_station:corporate_locator:shell"
    assert profile.is_franchise_pattern is True


def test_static_playbook_trusts_places_phone_for_franchise_gas() -> None:
    profile = classify_lead(_gas())
    static = static_playbook_for(profile)
    assert static is not None
    assert static.trust_google_phone is True
    assert static.skip_firecrawl is True


def test_fast_path_for_shell_with_google_phone(config_dir: Path) -> None:
    profile = classify_lead(_gas())
    rules = get_enrichment_rules("gas_station", config_dir)
    playbook = merge_playbooks(
        profile,
        static=static_playbook_for(profile),
        learned=None,
        mgmt=None,
        rules=rules,
    )
    use, reason = should_use_profile_fast_path(_gas(), profile, playbook, rules)
    assert use is True
    assert "franchise default" in reason or "relational profile" in reason


def test_fast_path_skipped_without_phone(config_dir: Path) -> None:
    profile = classify_lead(_gas(phone=None))
    rules = get_enrichment_rules("gas_station", config_dir)
    playbook = merge_playbooks(
        profile, static=static_playbook_for(profile), learned=None, mgmt=None, rules=rules
    )
    use, reason = should_use_profile_fast_path(_gas(phone=None), profile, playbook, rules)
    assert use is False
    assert "phone" in reason.lower()


def test_fast_path_skipped_for_strip_mall(config_dir: Path) -> None:
    raw = RawLead(
        place_id="places/mall",
        business_name="Reedley Shopping Center",
        formatted_address="1 Center",
        city="Reedley",
        state="CA",
        property_type="strip_mall",
        lead_category="Strip Mall",
        market_key="reedley",
        website="https://example.com",
        main_phone="(559) 638-0100",
    )
    profile = classify_lead(raw)
    rules = get_enrichment_rules("strip_mall", config_dir)
    playbook = EnrichmentPlaybook(trust_google_phone=True, skip_firecrawl=True)
    use, reason = should_use_profile_fast_path(raw, profile, playbook, rules)
    assert use is False
    assert "full" in reason.lower() or "property manager" in reason.lower()


@pytest.fixture
def config_dir() -> Path:
    return Path(__file__).resolve().parents[1] / "config"

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pallares_leads.enrich.contact_requirements import (
    clear_enrichment_rules_cache,
    get_enrichment_rules,
)
from pallares_leads.enrich.lead_profile import (
    classify_lead,
    merge_playbooks,
    should_use_profile_fast_path,
    static_playbook_for,
)
from pallares_leads.schemas import RawLead


@pytest.fixture(autouse=True)
def _clear_cache() -> None:
    clear_enrichment_rules_cache()


@pytest.fixture
def config_dir() -> Path:
    return Path(__file__).resolve().parents[1] / "config"


def test_golden_shell_franchise_fast_path(config_dir: Path) -> None:
    fixture = Path(__file__).parent / "fixtures" / "golden_leads.jsonl"
    line = fixture.read_text(encoding="utf-8").splitlines()[0]
    raw = RawLead.model_validate(json.loads(line))
    profile = classify_lead(raw)
    assert profile.brand == "shell"
    rules = get_enrichment_rules("gas_station", config_dir)
    playbook = merge_playbooks(
        profile,
        static=static_playbook_for(profile),
        learned=None,
        mgmt=None,
        rules=rules,
    )
    use, _ = should_use_profile_fast_path(raw, profile, playbook, rules)
    assert use is True


def test_golden_strip_mall_never_fast_path(config_dir: Path) -> None:
    fixture = Path(__file__).parent / "fixtures" / "golden_leads.jsonl"
    line = fixture.read_text(encoding="utf-8").splitlines()[1]
    raw = RawLead.model_validate(json.loads(line))
    profile = classify_lead(raw)
    rules = get_enrichment_rules("strip_mall", config_dir)
    playbook = merge_playbooks(
        profile,
        static=static_playbook_for(profile),
        learned=None,
        mgmt=None,
        rules=rules,
    )
    use, reason = should_use_profile_fast_path(raw, profile, playbook, rules)
    assert use is False
    assert "property manager" in reason.lower() or "full" in reason.lower()

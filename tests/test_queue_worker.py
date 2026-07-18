from __future__ import annotations

from pallares_leads.queue_worker import ALLOWED_ENV_OVERRIDES, apply_env_overrides


def test_apply_env_overrides_allowlisted_only() -> None:
    env = {"EXISTING": "1"}
    payload = {
        "env_overrides": {
            "FIRECRAWL_AGENT_MAX_CREDITS": "5",
            "NOT_ALLOWED": "evil",
        }
    }
    result = apply_env_overrides(env.copy(), payload)
    assert result["FIRECRAWL_AGENT_MAX_CREDITS"] == "5"
    assert result["EXISTING"] == "1"
    assert "NOT_ALLOWED" not in result


def test_allowed_env_override_keys_match_plan() -> None:
    assert ALLOWED_ENV_OVERRIDES == {"FIRECRAWL_AGENT_MAX_CREDITS"}

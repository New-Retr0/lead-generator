from __future__ import annotations

from pallares_leads.queue_worker import ALLOWED_ENV_OVERRIDES, apply_env_overrides


def test_apply_env_overrides_allowlisted_only() -> None:
    env = {"EXISTING": "1", "ENRICHMENT_PARALLEL_WORKERS": "4"}
    payload = {
        "env_overrides": {
            "ENRICHMENT_PARALLEL_WORKERS": "8",
            "FIRECRAWL_MAX_CONCURRENCY": "25",
            "AI_NEED_SIGNAL_FALLBACK": "true",
            "NOT_ALLOWED": "evil",
        }
    }
    result = apply_env_overrides(env.copy(), payload)
    assert result["ENRICHMENT_PARALLEL_WORKERS"] == "8"
    assert result["FIRECRAWL_MAX_CONCURRENCY"] == "25"
    assert result["AI_NEED_SIGNAL_FALLBACK"] == "true"
    assert result["EXISTING"] == "1"
    assert "NOT_ALLOWED" not in result


def test_allowed_env_override_keys_match_plan() -> None:
    expected = {
        "ENRICHMENT_PARALLEL_WORKERS",
        "FIRECRAWL_MAX_CONCURRENCY",
        "FIRECRAWL_MAX_CREDITS_PER_RUN",
        "FIRECRAWL_SESSION_CREDIT_STOP",
        "BROWSER_USE_ENABLED",
        "OWNER_CHAIN_BACKEND",
        "AI_GATEWAY_ENABLED",
        "AI_OWNER_DISAMBIGUATION",
        "AI_NEED_SIGNAL_FALLBACK",
    }
    assert ALLOWED_ENV_OVERRIDES == expected

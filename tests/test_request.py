from pathlib import Path

from pallares_leads.request.planner import _fallback_spec, estimate_request_cost, spec_from_dict
from pallares_leads.request.spec import BudgetCap, CorridorFilter, LeadRequestSpec
from pallares_leads.settings import Settings


def test_lead_request_spec_summary() -> None:
    spec = LeadRequestSpec(
        count=5,
        categories=["strip_mall"],
        market_keys=["reedley"],
        corridor=CorridorFilter(road_ref="CA-99"),
        budget=BudgetCap(max_firecrawl_credits=100),
        raw_prompt="5 strip malls in reedley along 99",
    )
    lines = spec.summary_lines()
    assert any("reedley" in line for line in lines)
    assert any("CA-99" in line for line in lines)


def test_fallback_parser_maps_reedley_and_parking() -> None:
    settings = Settings(config_dir=Path(__file__).resolve().parents[1] / "config")
    spec = _fallback_spec("5 parking lots in reedley along CA-99", settings)
    assert "reedley" in spec.market_keys
    assert spec.count == 5
    assert spec.corridor is not None
    assert spec.corridor.road_ref == "CA-99"


def test_request_budget_uses_plan_credit_cap_not_payload_usd(monkeypatch) -> None:
    settings = Settings(config_dir=Path(__file__).resolve().parents[1] / "config")
    monkeypatch.setenv("PALLARES_REQUEST_MAX_FIRECRAWL_CREDITS", "500000")

    spec = spec_from_dict(
        {
            "count": 5,
            "categories": ["strip_mall"],
            "market_keys": ["reedley"],
            "require_decision_maker": True,
            "recurring_only": False,
            "min_lead_score": 0,
            "budget": {"max_firecrawl_credits": 1, "max_usd": 9999},
        },
        settings=settings,
    )

    assert spec.budget.max_firecrawl_credits == 500000
    assert all("USD cap" not in line for line in spec.summary_lines())


def test_request_estimate_is_not_clipped_by_budget_cap() -> None:
    spec = LeadRequestSpec(
        count=5,
        categories=["strip_mall"],
        market_keys=["reedley"],
        budget=BudgetCap(max_firecrawl_credits=1),
    )

    cost = estimate_request_cost(spec)

    assert cost["total_credits_est"] == 67
    assert cost["usd_est"] > 0

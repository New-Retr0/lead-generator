from pathlib import Path

from pallares_leads.request.planner import _fallback_spec
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

from __future__ import annotations

from pallares_leads.intelligence.features import FEATURE_VERSION, build_feature_snapshot
from pallares_leads.schemas import Confidence, EnrichedLead, InvestigationStatus, RawLead


def _enriched() -> EnrichedLead:
    raw = RawLead(
        place_id="places/test",
        business_name="Valley Strip Mall",
        formatted_address="100 Main St",
        city="Reedley",
        state="CA",
        property_type="strip_mall",
        lead_category="Strip Mall",
        market_key="reedley",
        rating=4.2,
        user_rating_count=88,
        business_status="OPERATIONAL",
        opening_hours_json={"periods": [{"open": {"day": 1, "time": "0900"}}]},
        parking_options={"freeParkingLot": True},
    )
    lead = EnrichedLead(
        **raw.model_dump(),
        confidence=Confidence.HIGH,
        investigation_status=InvestigationStatus.ENRICHED,
        verification_level="verified",
        lead_score=72,
        score_breakdown={"contact": 40, "ticket": 18, "trigger": 5},
        source_tool="google_places+firecrawl",
    )
    lead.site_contacts = []
    return lead


def test_build_feature_snapshot_keys_and_types() -> None:
    features = build_feature_snapshot(
        _enriched(),
        run_id="run-1",
        category_key="strip_mall",
        profile_key="strip_mall_default",
        cost_summary={"credits_total": 12, "usd_total": 0.05},
    )
    assert features["feature_version"] == FEATURE_VERSION
    assert features["category_key"] == "strip_mall"
    assert features["rating"] == 4.2
    assert features["has_parking_lot"] is True
    assert features["score_contact"] == 40
    assert features["credits_total"] == 12
    for key, value in features.items():
        assert isinstance(value, (int, float, bool, str)), f"{key} has bad type {type(value)}"

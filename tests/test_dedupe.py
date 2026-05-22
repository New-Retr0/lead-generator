from pallares_leads.schemas import RawLead
from pallares_leads.pipeline.dedupe import dedupe_by_place_id


def test_dedupe_by_place_id():
    base = dict(
        business_name="Test",
        formatted_address="123 Main",
        city="Reedley",
        state="CA",
        property_type="gas_station",
        lead_category="Gas Station",
    )
    a = RawLead(place_id="places/abc", **base)
    b = RawLead(place_id="places/abc", business_name="Duplicate", **{k: v for k, v in base.items() if k != "business_name"})
    c = RawLead(place_id="places/xyz", **base)

    result = dedupe_by_place_id([a, b, c])
    assert len(result) == 2
    assert result[0].place_id == "places/abc"
    assert result[1].place_id == "places/xyz"

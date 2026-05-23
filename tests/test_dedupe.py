from pallares_leads.schemas import RawLead
from pallares_leads.pipeline.dedupe import dedupe_by_fingerprint, dedupe_by_place_id, dedupe_leads


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


def test_dedupe_by_fingerprint_same_brand_and_address():
    base = dict(
        business_name="Shell",
        formatted_address="1239 N Reed Ave, Reedley, CA",
        city="Reedley",
        state="CA",
        property_type="gas_station",
        lead_category="Gas Station",
        website="https://find.shell.com/locator",
    )
    a = RawLead(place_id="places/shell-a", **base)
    b = RawLead(place_id="places/shell-b", **base)

    kept, skipped = dedupe_by_fingerprint([a, b])
    assert len(kept) == 1
    assert skipped == 1


def test_dedupe_leads_combines_both():
    base = dict(
        business_name="Chevron",
        formatted_address="500 E Manning Ave, Reedley, CA",
        city="Reedley",
        state="CA",
        property_type="gas_station",
        lead_category="Gas Station",
    )
    a = RawLead(place_id="places/c1", **base)
    b = RawLead(place_id="places/c1", **base)
    c = RawLead(place_id="places/c2", **base)

    kept, skipped = dedupe_leads([a, b, c])
    assert len(kept) == 1
    assert skipped == 2

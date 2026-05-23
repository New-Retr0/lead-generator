from pallares_leads.schemas import RawLead
from pallares_leads.pipeline.dedupe import dedupe_by_geohash
from pallares_leads.utils.geohash import encode_geohash


def test_encode_geohash_reedley() -> None:
    gh = encode_geohash(36.5963, -119.4504, precision=7)
    assert len(gh) == 7
    assert gh == encode_geohash(36.5963, -119.4504, precision=7)


def test_geohash_dedupe_same_location() -> None:
    base = dict(
        business_name="Shell",
        formatted_address="1239 N Reed Ave",
        city="Reedley",
        state="CA",
        property_type="gas_station",
        lead_category="Gas Station",
        website="https://find.shell.com",
        latitude=36.5963,
        longitude=-119.4504,
    )
    a = RawLead(place_id="places/a", **base)
    b = RawLead(place_id="places/b", **base)
    kept, skipped = dedupe_by_geohash([a, b])
    assert len(kept) == 1
    assert skipped == 1

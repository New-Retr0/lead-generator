from pallares_leads.discover.overpass import OverpassClient


def test_area_classification_bounds() -> None:
    assert OverpassClient._matches_area(600, area_min_m2=500, area_max_m2=4000)
    assert not OverpassClient._matches_area(100, area_min_m2=500, area_max_m2=4000)
    assert not OverpassClient._matches_area(5000, area_min_m2=500, area_max_m2=4000)
    assert OverpassClient._matches_area(10_000, area_min_m2=8000, area_max_m2=None)


def test_private_access_filter() -> None:
    assert OverpassClient._matches_access({"access": "private"}, prefer_private=True)
    assert not OverpassClient._matches_access({"access": "public"}, prefer_private=True)
    assert OverpassClient._matches_access({"access": "public"}, prefer_private=False)

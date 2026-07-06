from pallares_leads.utils.geo import (
    haversine_m,
    market_bbox,
    point_to_polyline_distance_m,
    polygon_area_m2,
    tile_circles,
    within_corridor_buffer,
)


def test_haversine_same_point_is_zero() -> None:
    assert haversine_m(36.5963, -119.4504, 36.5963, -119.4504) == 0.0


def test_polygon_area_square() -> None:
    # ~100m x 100m square near Reedley
    lat, lon = 36.5963, -119.4504
    delta = 0.0009
    coords = [
        (lat, lon),
        (lat + delta, lon),
        (lat + delta, lon + delta),
        (lat, lon + delta),
    ]
    area = polygon_area_m2(coords)
    assert 8_000 < area < 12_000


def test_within_corridor_buffer() -> None:
    polyline = [(36.59, -119.45), (36.60, -119.44)]
    assert within_corridor_buffer(36.595, -119.445, polyline, buffer_m=2000)
    assert not within_corridor_buffer(36.70, -119.44, polyline, buffer_m=100)


def test_point_to_polyline_distance() -> None:
    polyline = [(36.0, -119.0), (37.0, -119.0)]
    dist = point_to_polyline_distance_m(36.5, -119.0, polyline)
    assert dist < 100


def test_market_bbox_has_four_values() -> None:
    bbox = market_bbox(36.5963, -119.4504, 10_000)
    assert len(bbox) == 4
    south, west, north, east = bbox
    assert south < north
    assert west < east


def test_tile_circles_covers_bbox() -> None:
    bbox = market_bbox(36.5963, -119.4504, 20_000)
    centers = tile_circles(bbox, 15_000)
    assert len(centers) >= 1
    south, west, north, east = bbox
    for lat, lon in centers:
        assert south - 0.01 <= lat <= north + 0.01
        assert west - 0.01 <= lon <= east + 0.01


def test_tile_circles_empty_for_zero_radius() -> None:
    bbox = market_bbox(36.5963, -119.4504, 10_000)
    assert tile_circles(bbox, 0) == []

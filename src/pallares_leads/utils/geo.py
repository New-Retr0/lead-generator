from __future__ import annotations

import math
from collections.abc import Sequence

EARTH_RADIUS_M = 6_371_000.0


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two WGS84 points in meters."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def _meters_per_degree_lat(lat: float) -> float:
    return 111_132.92 - 559.82 * math.cos(2 * math.radians(lat))


def _meters_per_degree_lon(lat: float) -> float:
    return 111_412.84 * math.cos(math.radians(lat))


def polygon_area_m2(coords: Sequence[tuple[float, float]]) -> float:
    """Shoelace area for a lat/lng polygon, projected to approximate m²."""
    if len(coords) < 3:
        return 0.0
    ring = list(coords)
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    ref_lat = sum(c[0] for c in ring) / len(ring)
    scale_x = _meters_per_degree_lon(ref_lat)
    scale_y = _meters_per_degree_lat(ref_lat)
    area = 0.0
    for i in range(len(ring) - 1):
        lat1, lon1 = ring[i]
        lat2, lon2 = ring[i + 1]
        x1, y1 = lon1 * scale_x, lat1 * scale_y
        x2, y2 = lon2 * scale_x, lat2 * scale_y
        area += x1 * y2 - x2 * y1
    return abs(area) / 2.0


def point_to_segment_distance_m(
    lat: float,
    lon: float,
    lat1: float,
    lon1: float,
    lat2: float,
    lon2: float,
) -> float:
    """Minimum distance from point to a line segment on the Earth's surface (approx)."""
    if lat1 == lat2 and lon1 == lon2:
        return haversine_m(lat, lon, lat1, lon1)

    ref_lat = (lat + lat1 + lat2) / 3.0
    scale_x = _meters_per_degree_lon(ref_lat)
    scale_y = _meters_per_degree_lat(ref_lat)
    px, py = lon * scale_x, lat * scale_y
    x1, y1 = lon1 * scale_x, lat1 * scale_y
    x2, y2 = lon2 * scale_x, lat2 * scale_y
    dx, dy = x2 - x1, y2 - y1
    length_sq = dx * dx + dy * dy
    if length_sq == 0:
        return haversine_m(lat, lon, lat1, lon1)
    t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / length_sq))
    proj_x = x1 + t * dx
    proj_y = y1 + t * dy
    proj_lon = proj_x / scale_x
    proj_lat = proj_y / scale_y
    return haversine_m(lat, lon, proj_lat, proj_lon)


def point_to_polyline_distance_m(
    lat: float,
    lon: float,
    polyline: Sequence[tuple[float, float]],
) -> float:
    """Minimum distance from a point to a polyline (sequence of lat/lng vertices)."""
    if len(polyline) < 2:
        if polyline:
            return haversine_m(lat, lon, polyline[0][0], polyline[0][1])
        return float("inf")
    best = float("inf")
    for i in range(len(polyline) - 1):
        lat1, lon1 = polyline[i]
        lat2, lon2 = polyline[i + 1]
        dist = point_to_segment_distance_m(lat, lon, lat1, lon1, lat2, lon2)
        best = min(best, dist)
    return best


def within_corridor_buffer(
    lat: float | None,
    lon: float | None,
    polyline: Sequence[tuple[float, float]],
    buffer_m: float,
) -> bool:
    """True when a point lies within buffer_m of the polyline."""
    if lat is None or lon is None or not polyline:
        return False
    return point_to_polyline_distance_m(lat, lon, polyline) <= buffer_m


def market_bbox(
    lat: float,
    lon: float,
    radius_m: float,
) -> tuple[float, float, float, float]:
    """Return (south, west, north, east) bbox from center + radius."""
    lat_delta = radius_m / _meters_per_degree_lat(lat)
    lon_delta = radius_m / _meters_per_degree_lon(lat)
    return (
        lat - lat_delta,
        lon - lon_delta,
        lat + lat_delta,
        lon + lon_delta,
    )


def tile_circles(
    bbox: tuple[float, float, float, float],
    radius_m: float,
) -> list[tuple[float, float]]:
    """Hex-packed circle centers covering a bbox for tiled Places discovery.

    Each center is suitable as the center of a locationBias circle with *radius_m*.
    Row spacing uses sqrt(3)/2 overlap so adjacent tiles share coverage.
    """
    if radius_m <= 0:
        return []

    south, west, north, east = bbox
    ref_lat = (south + north) / 2.0
    lat_scale = _meters_per_degree_lat(ref_lat)
    lon_scale = _meters_per_degree_lon(ref_lat)

    row_step_m = radius_m * math.sqrt(3)
    col_step_m = radius_m * 1.5
    row_step = row_step_m / lat_scale
    col_step = col_step_m / lon_scale
    row_offset = (radius_m * 0.75) / lon_scale

    centers: list[tuple[float, float]] = []
    lat = south + row_step / 2.0
    row = 0
    while lat <= north + 1e-9:
        lon_start = west + (row_offset if row % 2 else 0.0) + col_step / 2.0
        lon = lon_start
        while lon <= east + 1e-9:
            centers.append((lat, lon))
            lon += col_step
        lat += row_step
        row += 1

    if not centers:
        center_lat = (south + north) / 2.0
        center_lon = (west + east) / 2.0
        centers.append((center_lat, center_lon))
    return centers

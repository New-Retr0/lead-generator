from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from pallares_leads.config_loader import CategoryConfig, MarketConfig
from pallares_leads.db.raw_archive import record_capture
from pallares_leads.schemas import RawLead
from pallares_leads.settings import Settings
from pallares_leads.utils.geo import market_bbox, polygon_area_m2
from pallares_leads.utils.normalize import parse_city_state_zip

logger = logging.getLogger(__name__)

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
REQUEST_DELAY_S = 1.1


def _bbox_for_market(market: MarketConfig) -> tuple[float, float, float, float]:
    explicit = market.get("bbox")
    if explicit and len(explicit) == 4:
        south, west, north, east = explicit
        return float(south), float(west), float(north), float(east)
    lat = float(market["latitude"])
    lon = float(market["longitude"])
    radius = float(market.get("search_radius_m") or 15_000)
    return market_bbox(lat, lon, radius)


def _build_query(
    south: float,
    west: float,
    north: float,
    east: float,
    overpass_filter: str,
) -> str:
    return f"""
[out:json][timeout:60];
(
  way{overpass_filter}({south},{west},{north},{east});
);
out body;
>;
out skel qt;
""".strip()


def _way_center(nodes: dict[int, dict[str, float]], way_nodes: list[int]) -> tuple[float, float]:
    lats: list[float] = []
    lons: list[float] = []
    for node_id in way_nodes:
        node = nodes.get(node_id)
        if node:
            lats.append(node["lat"])
            lons.append(node["lon"])
    if not lats:
        return 0.0, 0.0
    return sum(lats) / len(lats), sum(lons) / len(lons)


def _way_coords(
    nodes: dict[int, dict[str, float]], way_nodes: list[int]
) -> list[tuple[float, float]]:
    coords: list[tuple[float, float]] = []
    for node_id in way_nodes:
        node = nodes.get(node_id)
        if node:
            coords.append((node["lat"], node["lon"]))
    return coords


def _reverse_geocode(
    lat: float,
    lon: float,
    *,
    city_fallback: str,
    state_fallback: str,
    settings: Settings,
) -> str:
    params = {
        "lat": lat,
        "lon": lon,
        "format": "json",
        "addressdetails": 1,
    }
    headers = {"User-Agent": "pallares-leads/0.1 (commercial lead discovery)"}
    payload: dict[str, Any] = {}
    try:
        with httpx.Client(timeout=15.0) as client:
            response = client.get(NOMINATIM_URL, params=params, headers=headers)
            response.raise_for_status()
            payload = response.json()
            record_capture(
                settings,
                "nominatim",
                "reverse",
                request={"lat": lat, "lon": lon},
                response=payload,
            )
            address = payload.get("display_name") or ""
            if address:
                return address
    except httpx.HTTPError as exc:
        logger.debug("Nominatim reverse geocode failed: %s", exc)
    return f"Near {city_fallback}, {state_fallback}"


class OverpassClient:
    """Discover parking lots and similar features from OpenStreetMap."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._last_geocode_at = 0.0

    def _throttle_geocode(self) -> None:
        elapsed = time.monotonic() - self._last_geocode_at
        if elapsed < REQUEST_DELAY_S:
            time.sleep(REQUEST_DELAY_S - elapsed)
        self._last_geocode_at = time.monotonic()

    def fetch_ways(
        self,
        market: MarketConfig,
        *,
        overpass_filter: str,
    ) -> list[dict[str, Any]]:
        south, west, north, east = _bbox_for_market(market)
        query = _build_query(south, west, north, east, overpass_filter)
        with httpx.Client(timeout=90.0) as client:
            response = client.post(OVERPASS_URL, data={"data": query})
            response.raise_for_status()
            payload = response.json()
            record_capture(
                self._settings,
                "overpass",
                "interpreter",
                request={"query": query},
                response=payload,
            )

        nodes: dict[int, dict[str, float]] = {}
        ways: list[dict[str, Any]] = []
        for element in payload.get("elements") or []:
            if element.get("type") == "node":
                nodes[int(element["id"])] = {
                    "lat": float(element["lat"]),
                    "lon": float(element["lon"]),
                }
            elif element.get("type") == "way":
                ways.append(element)
        return [{"way": way, "nodes": nodes} for way in ways]

    @staticmethod
    def _matches_area(
        area_m2: float,
        *,
        area_min_m2: float | None,
        area_max_m2: float | None,
    ) -> bool:
        if area_min_m2 is not None and area_m2 < area_min_m2:
            return False
        if area_max_m2 is not None and area_m2 > area_max_m2:
            return False
        return True

    @staticmethod
    def _matches_access(tags: dict[str, str], *, prefer_private: bool) -> bool:
        access = (tags.get("access") or "").lower()
        parking_access = (tags.get("parking") or "").lower()
        if prefer_private:
            if access in ("public", "customers"):
                return False
            if parking_access == "street_side":
                return False
        return True

    def way_to_raw_lead(
        self,
        way: dict[str, Any],
        nodes: dict[int, dict[str, float]],
        *,
        property_type: str,
        lead_category: str,
        market_key: str,
        market: MarketConfig,
        area_min_m2: float | None = None,
        area_max_m2: float | None = None,
        prefer_private: bool = False,
    ) -> RawLead | None:
        way_id = int(way["id"])
        tags = way.get("tags") or {}
        way_nodes = [int(n) for n in way.get("nodes") or []]
        if len(way_nodes) < 3:
            return None

        coords = _way_coords(nodes, way_nodes)
        area_m2 = polygon_area_m2(coords)
        if not self._matches_area(area_m2, area_min_m2=area_min_m2, area_max_m2=area_max_m2):
            return None
        if not self._matches_access(tags, prefer_private=prefer_private):
            return None

        lat, lon = _way_center(nodes, way_nodes)
        city = market["city"]
        state = market["state"]
        self._throttle_geocode()
        formatted_address = _reverse_geocode(
            lat,
            lon,
            city_fallback=city,
            state_fallback=state,
            settings=self._settings,
        )
        parsed_city, parsed_state, zip_code = parse_city_state_zip(formatted_address, city, state)

        name = tags.get("name") or tags.get("operator") or f"Parking lot ({int(area_m2)} m²)"
        return RawLead(
            place_id=f"osm:{way_id}",
            business_name=name,
            formatted_address=formatted_address,
            city=parsed_city,
            state=parsed_state,
            zip_code=zip_code,
            latitude=lat,
            longitude=lon,
            property_type=property_type,
            lead_category=lead_category,
            google_types=["osm_parking"],
            discovery_query=f"overpass:{tags.get('amenity', 'parking')}",
            market_key=market_key,
            osm_area_m2=area_m2,
            osm_tags={"tags": dict(tags), "node_count": len(way_nodes)},
        )

    def discover_category(
        self,
        *,
        market_key: str,
        market: MarketConfig,
        category: CategoryConfig,
        limit: int | None = None,
    ) -> list[RawLead]:
        overpass_filter = category.get("overpass_filter") or '["amenity"="parking"]'
        area_min = category.get("area_min_m2")
        area_max = category.get("area_max_m2")
        prefer_private = bool(category.get("prefer_private_access"))

        property_type = category["property_type"]
        lead_category = category["label"]

        leads: list[RawLead] = []
        seen: set[str] = set()

        try:
            way_batches = self.fetch_ways(market, overpass_filter=overpass_filter)
        except httpx.HTTPError as exc:
            logger.error("Overpass query failed for %s: %s", market_key, exc)
            return []

        for item in way_batches:
            lead = self.way_to_raw_lead(
                item["way"],
                item["nodes"],
                property_type=property_type,
                lead_category=lead_category,
                market_key=market_key,
                market=market,
                area_min_m2=float(area_min) if area_min is not None else None,
                area_max_m2=float(area_max) if area_max is not None else None,
                prefer_private=prefer_private,
            )
            if lead and lead.place_id not in seen:
                seen.add(lead.place_id)
                leads.append(lead)
            if limit and len(leads) >= limit:
                break

        leads.sort(key=lambda lead: lead.osm_area_m2 or 0, reverse=True)
        if limit:
            leads = leads[:limit]

        logger.info(
            "Overpass discovered %d parking feature(s) for %s / %s in %s, %s",
            len(leads),
            market_key,
            property_type,
            market["city"],
            market["state"],
        )
        return leads

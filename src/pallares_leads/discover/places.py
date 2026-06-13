from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING, Any

import httpx

from pallares_leads.config_loader import CategoryConfig, MarketConfig
from pallares_leads.costs import load_pricing, usd_for
from pallares_leads.schemas import RawLead
from pallares_leads.settings import Settings
from pallares_leads.utils.normalize import normalize_phone, normalize_website, parse_city_state_zip

if TYPE_CHECKING:
    from pallares_leads.db.store import LeadStore

logger = logging.getLogger(__name__)

# Pro + Enterprise fields only — phone/website require Enterprise SKU (required for leads).
_PLACE_FIELDS = (
    "places.id,places.displayName,places.formattedAddress,places.location,"
    "places.types,places.primaryType,places.googleMapsUri,places.businessStatus,"
    "places.nationalPhoneNumber,places.websiteUri"
)

SEARCH_FIELD_MASK = f"{_PLACE_FIELDS},nextPageToken"

# Nearby Search rejects nextPageToken in the field mask (no pagination support).
NEARBY_FIELD_MASK = _PLACE_FIELDS

MAX_PAGES = 3  # Text Search (New) caps at 60 results total (3 × 20)
PAGE_DELAY_S = 0.2


class PlacesClient:
    BASE_URL = "https://places.googleapis.com/v1"

    def __init__(
        self,
        settings: Settings,
        *,
        store: LeadStore | None = None,
        run_id: str | None = None,
    ) -> None:
        if not settings.google_places_api_key:
            raise ValueError("GOOGLE_PLACES_API_KEY is required for discovery")
        self._api_key = settings.google_places_api_key
        self._settings = settings
        self._store = store
        self._run_id = run_id
        self.request_count = 0

    def _record_request(self, operation: str) -> None:
        self.request_count += 1
        if not self._store:
            return
        pricing = load_pricing(self._settings.config_dir)
        cost_usd = usd_for(
            pricing,
            provider="google_places",
            operation=operation,
            units=1,
            unit_type="requests",
        )
        self._store.record_cost_event(
            provider="google_places",
            operation=operation,
            units=1,
            unit_type="requests",
            usd=cost_usd,
            run_id=self._run_id,
        )

    def _headers(self, field_mask: str) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": self._api_key,
            "X-Goog-FieldMask": field_mask,
        }

    @staticmethod
    def _location_bias(market: MarketConfig) -> dict[str, Any] | None:
        lat = market.get("latitude")
        lng = market.get("longitude")
        if lat is None or lng is None:
            return None
        radius = float(market.get("search_radius_m") or 15_000)
        return {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": min(radius, 50_000.0),
            }
        }

    def health_check(self) -> tuple[bool, str]:
        """Minimal Text Search — Essentials-tier field mask for cheap validation."""
        body = {
            "textQuery": "gas station in Reedley, CA",
            "pageSize": 1,
            "regionCode": "US",
            "languageCode": "en",
        }
        try:
            with httpx.Client(timeout=15.0) as client:
                response = client.post(
                    f"{self.BASE_URL}/places:searchText",
                    headers=self._headers("places.id,places.displayName"),
                    json=body,
                )
                if response.status_code == 200:
                    count = len(response.json().get("places") or [])
                    return True, f"OK ({count} sample result)"
                return False, f"HTTP {response.status_code}: {response.text[:300]}"
        except httpx.HTTPError as exc:
            return False, str(exc)

    def search_text(
        self,
        text_query: str,
        *,
        market: MarketConfig,
        included_type: str | None = None,
        page_token: str | None = None,
    ) -> dict[str, Any]:
        city = market["city"]
        state = market["state"]
        body: dict[str, Any] = {
            "textQuery": f"{text_query} in {city}, {state}",
            "pageSize": min(self._settings.max_places_per_query, 20),
            "languageCode": "en",
            "regionCode": "US",
        }
        bias = self._location_bias(market)
        if bias:
            body["locationBias"] = bias
        if included_type:
            body["includedType"] = included_type
        if page_token:
            body["pageToken"] = page_token

        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                f"{self.BASE_URL}/places:searchText",
                headers=self._headers(SEARCH_FIELD_MASK),
                json=body,
            )
            response.raise_for_status()
            self._record_request("text_search")
            return response.json()

    def search_nearby(
        self,
        *,
        market: MarketConfig,
        included_types: list[str],
    ) -> dict[str, Any]:
        lat = market.get("latitude")
        lng = market.get("longitude")
        if lat is None or lng is None:
            return {"places": []}

        radius = float(market.get("search_radius_m") or 15_000)
        body: dict[str, Any] = {
            "includedTypes": included_types[:5],
            "maxResultCount": 20,
            "languageCode": "en",
            "regionCode": "US",
            "locationRestriction": {
                "circle": {
                    "center": {"latitude": lat, "longitude": lng},
                    "radius": min(radius, 50_000.0),
                }
            },
        }

        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                f"{self.BASE_URL}/places:searchNearby",
                headers=self._headers(NEARBY_FIELD_MASK),
                json=body,
            )
            response.raise_for_status()
            self._record_request("nearby_search")
            return response.json()

    @staticmethod
    def _skip_place(place: dict[str, Any]) -> bool:
        status = place.get("businessStatus")
        return status == "CLOSED_PERMANENTLY"

    def place_to_raw_lead(
        self,
        place: dict[str, Any],
        *,
        property_type: str,
        lead_category: str,
        discovery_query: str,
        market_key: str,
        fallback_city: str,
        fallback_state: str,
    ) -> RawLead | None:
        if self._skip_place(place):
            return None

        place_id = place.get("id")
        if not place_id:
            return None

        display = place.get("displayName") or {}
        name = display.get("text") if isinstance(display, dict) else str(display)
        if not name:
            return None

        formatted_address = place.get("formattedAddress") or ""
        city, state, zip_code = parse_city_state_zip(
            formatted_address, fallback_city, fallback_state
        )

        location = place.get("location") or {}
        types = list(place.get("types") or [])
        primary = place.get("primaryType")
        if primary and primary not in types:
            types.insert(0, primary)

        return RawLead(
            place_id=place_id,
            business_name=name,
            formatted_address=formatted_address,
            city=city,
            state=state,
            zip_code=zip_code,
            latitude=location.get("latitude"),
            longitude=location.get("longitude"),
            property_type=property_type,
            lead_category=lead_category,
            website=normalize_website(place.get("websiteUri")),
            google_maps_url=place.get("googleMapsUri"),
            main_phone=normalize_phone(place.get("nationalPhoneNumber")),
            google_types=types,
            discovery_query=discovery_query,
            market_key=market_key,
        )

    def _collect_from_payload(
        self,
        payload: dict[str, Any],
        *,
        property_type: str,
        lead_category: str,
        discovery_query: str,
        market_key: str,
        market: MarketConfig,
        seen_ids: set[str],
        leads: list[RawLead],
    ) -> None:
        for place in payload.get("places") or []:
            lead = self.place_to_raw_lead(
                place,
                property_type=property_type,
                lead_category=lead_category,
                discovery_query=discovery_query,
                market_key=market_key,
                fallback_city=market["city"],
                fallback_state=market["state"],
            )
            if lead and lead.place_id not in seen_ids:
                seen_ids.add(lead.place_id)
                leads.append(lead)

    def discover_category(
        self,
        *,
        market_key: str,
        market: MarketConfig,
        category: CategoryConfig,
        limit: int | None = None,
    ) -> list[RawLead]:
        city = market["city"]
        state = market["state"]
        property_type = category["property_type"]
        lead_category = category["label"]
        queries = category["queries"]
        included_type = category.get("included_type")
        nearby_types = category.get("nearby_types") or []

        leads: list[RawLead] = []
        seen_ids: set[str] = set()

        if nearby_types:
            try:
                nearby_payload = self.search_nearby(market=market, included_types=nearby_types)
                self._collect_from_payload(
                    nearby_payload,
                    property_type=property_type,
                    lead_category=lead_category,
                    discovery_query=f"nearby:{','.join(nearby_types[:3])}",
                    market_key=market_key,
                    market=market,
                    seen_ids=seen_ids,
                    leads=leads,
                )
            except httpx.HTTPStatusError as exc:
                logger.error("Nearby search failed: %s", exc.response.text[:300])

        if limit and len(leads) >= limit:
            logger.info(
                "Discovered %d places (limit %d) for %s / %s in %s, %s",
                len(leads[:limit]),
                limit,
                market_key,
                property_type,
                city,
                state,
            )
            return leads[:limit]

        for query in queries:
            page_token: str | None = None
            for _page in range(MAX_PAGES):
                try:
                    payload = self.search_text(
                        query,
                        market=market,
                        included_type=included_type,
                        page_token=page_token,
                    )
                except httpx.HTTPStatusError as exc:
                    logger.error("Text search failed for %r: %s", query, exc.response.text[:300])
                    break

                self._collect_from_payload(
                    payload,
                    property_type=property_type,
                    lead_category=lead_category,
                    discovery_query=query,
                    market_key=market_key,
                    market=market,
                    seen_ids=seen_ids,
                    leads=leads,
                )

                if limit and len(leads) >= limit:
                    break

                page_token = payload.get("nextPageToken")
                if not page_token:
                    break
                time.sleep(PAGE_DELAY_S)

            if limit and len(leads) >= limit:
                break

        if limit and len(leads) > limit:
            leads = leads[:limit]

        if self._store and self.request_count:
            self._store.commit_cost_events()

        logger.info(
            "Discovered %d unique places for %s / %s in %s, %s (%d Places API request(s))",
            len(leads),
            market_key,
            property_type,
            city,
            state,
            self.request_count,
        )
        return leads

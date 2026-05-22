from __future__ import annotations

import logging
from typing import Any

import httpx

from pallares_leads.schemas import RawLead
from pallares_leads.settings import Settings
from pallares_leads.utils.normalize import normalize_phone, normalize_website, parse_city_state_zip

logger = logging.getLogger(__name__)

SEARCH_FIELD_MASK = (
    "places.id,places.displayName,places.formattedAddress,places.location,"
    "places.types,places.googleMapsUri,places.nationalPhoneNumber,places.websiteUri,"
    "nextPageToken"
)

DETAILS_FIELD_MASK = (
    "id,displayName,formattedAddress,location,types,googleMapsUri,"
    "nationalPhoneNumber,websiteUri"
)


class PlacesClient:
    BASE_URL = "https://places.googleapis.com/v1"

    def __init__(self, settings: Settings) -> None:
        if not settings.google_places_api_key:
            raise ValueError("GOOGLE_PLACES_API_KEY is required for discovery")
        self._api_key = settings.google_places_api_key
        self._settings = settings

    def _headers(self, field_mask: str) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": self._api_key,
            "X-Goog-FieldMask": field_mask,
        }

    def search_text(
        self,
        text_query: str,
        *,
        city: str,
        state: str,
        page_token: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "textQuery": f"{text_query} in {city}, {state}",
            "pageSize": min(self._settings.max_places_per_query, 20),
            "languageCode": "en",
        }
        if page_token:
            body["pageToken"] = page_token

        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                f"{self.BASE_URL}/places:searchText",
                headers=self._headers(SEARCH_FIELD_MASK),
                json=body,
            )
            response.raise_for_status()
            return response.json()

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
        lat = location.get("latitude")
        lng = location.get("longitude")

        return RawLead(
            place_id=place_id,
            business_name=name,
            formatted_address=formatted_address,
            city=city,
            state=state,
            zip_code=zip_code,
            latitude=lat,
            longitude=lng,
            property_type=property_type,
            lead_category=lead_category,
            website=normalize_website(place.get("websiteUri")),
            google_maps_url=place.get("googleMapsUri"),
            main_phone=normalize_phone(place.get("nationalPhoneNumber")),
            google_types=list(place.get("types") or []),
            discovery_query=discovery_query,
            market_key=market_key,
        )

    def discover_category(
        self,
        *,
        market_key: str,
        city: str,
        state: str,
        property_type: str,
        lead_category: str,
        queries: list[str],
    ) -> list[RawLead]:
        leads: list[RawLead] = []
        seen_ids: set[str] = set()

        for query in queries:
            page_token: str | None = None
            pages = 0
            while pages < 3:
                pages += 1
                try:
                    payload = self.search_text(
                        query, city=city, state=state, page_token=page_token
                    )
                except httpx.HTTPStatusError as exc:
                    logger.error("Places search failed for %r: %s", query, exc.response.text)
                    break

                for place in payload.get("places") or []:
                    lead = self.place_to_raw_lead(
                        place,
                        property_type=property_type,
                        lead_category=lead_category,
                        discovery_query=query,
                        market_key=market_key,
                        fallback_city=city,
                        fallback_state=state,
                    )
                    if lead and lead.place_id not in seen_ids:
                        seen_ids.add(lead.place_id)
                        leads.append(lead)

                page_token = payload.get("nextPageToken")
                if not page_token:
                    break

        logger.info(
            "Discovered %d unique places for %s / %s in %s, %s",
            len(leads),
            market_key,
            property_type,
            city,
            state,
        )
        return leads

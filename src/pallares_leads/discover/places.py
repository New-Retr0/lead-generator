from __future__ import annotations

import logging
import time
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

import httpx

from pallares_leads.config_loader import CategoryConfig, MarketConfig
from pallares_leads.costs import load_pricing, usd_for
from pallares_leads.db.raw_archive import record_capture
from pallares_leads.schemas import RawLead
from pallares_leads.settings import Settings
from pallares_leads.utils.geo import market_bbox, tile_circles
from pallares_leads.utils.http_retry import request_with_retry
from pallares_leads.utils.normalize import normalize_phone, normalize_website, parse_city_state_zip

if TYPE_CHECKING:
    from pallares_leads.db.store import LeadStore

logger = logging.getLogger(__name__)

# Enterprise (Contact) SKU only — phone/website hold us at Enterprise ($0.035/req,
# verified 2026-07-20 at developers.google.com/maps/billing-and-pricing/pricing).
# No Atmosphere fields (reviews/rating/priceLevel/priceRange/editorialSummary/
# parkingOptions/paymentOptions) — they would force the Enterprise + Atmosphere SKU
# ($0.040) and feed nothing but the (out-of-scope) learning snapshot. Keep this mask
# free of Atmosphere fields; test_places_mask_sku guards it against the priced SKU.
_PLACE_FIELDS = (
    "places.id,places.displayName,places.formattedAddress,places.shortFormattedAddress,"
    "places.location,places.types,places.primaryType,places.primaryTypeDisplayName,"
    "places.googleMapsUri,places.businessStatus,places.pureServiceAreaBusiness,"
    "places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri"
)

# Atmosphere-tier fields that must never re-enter _PLACE_FIELDS without also bumping
# the priced SKU in config/pricing.yaml (guarded by test_places_mask_sku).
ATMOSPHERE_FIELDS = frozenset(
    {
        "places.reviews",
        "places.rating",
        "places.userRatingCount",
        "places.priceLevel",
        "places.priceRange",
        "places.editorialSummary",
        "places.parkingOptions",
        "places.paymentOptions",
    }
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

    def _record_request(self, operation: str, *, duration_ms: int) -> None:
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
            meta={"duration_ms": duration_ms, "stage": "discovery"},
        )

    def _headers(self, field_mask: str) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": self._api_key,
            "X-Goog-FieldMask": field_mask,
        }

    @staticmethod
    def _location_bias(
        market: MarketConfig,
        *,
        center_lat: float | None = None,
        center_lng: float | None = None,
        radius_m: float | None = None,
    ) -> dict[str, Any] | None:
        lat = center_lat if center_lat is not None else market.get("latitude")
        lng = center_lng if center_lng is not None else market.get("longitude")
        if lat is None or lng is None:
            return None
        radius = float(
            radius_m if radius_m is not None else market.get("search_radius_m") or 15_000
        )
        return {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": min(radius, 50_000.0),
            }
        }

    def _archive_response(
        self,
        operation: str,
        *,
        request: dict[str, Any],
        response: dict[str, Any],
        duration_ms: int,
    ) -> None:
        record_capture(
            self._settings,
            "google_places",
            operation,
            run_id=self._run_id,
            request=request,
            response=response,
            duration_ms=duration_ms,
        )

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
        center_lat: float | None = None,
        center_lng: float | None = None,
        radius_m: float | None = None,
    ) -> dict[str, Any]:
        city = market["city"]
        state = market["state"]
        body: dict[str, Any] = {
            "textQuery": f"{text_query} in {city}, {state}",
            "pageSize": min(self._settings.max_places_per_query, 20),
            "languageCode": "en",
            "regionCode": "US",
        }
        bias = self._location_bias(
            market,
            center_lat=center_lat,
            center_lng=center_lng,
            radius_m=radius_m,
        )
        if bias:
            body["locationBias"] = bias
        if included_type:
            body["includedType"] = included_type
        if page_token:
            body["pageToken"] = page_token

        with httpx.Client(timeout=30.0) as client:
            started = time.perf_counter()
            response = request_with_retry(
                lambda: client.post(
                    f"{self.BASE_URL}/places:searchText",
                    headers=self._headers(SEARCH_FIELD_MASK),
                    json=body,
                ),
                label="Places searchText",
            )
            response.raise_for_status()
            duration_ms = int((time.perf_counter() - started) * 1000)
            self._record_request("text_search", duration_ms=duration_ms)
            payload = response.json()
            self._archive_response(
                "text_search",
                request=body,
                response=payload,
                duration_ms=duration_ms,
            )
            return payload

    def search_nearby(
        self,
        *,
        market: MarketConfig,
        included_types: list[str],
        center_lat: float | None = None,
        center_lng: float | None = None,
        radius_m: float | None = None,
    ) -> dict[str, Any]:
        lat = center_lat if center_lat is not None else market.get("latitude")
        lng = center_lng if center_lng is not None else market.get("longitude")
        if lat is None or lng is None:
            return {"places": []}

        radius = float(
            radius_m if radius_m is not None else market.get("search_radius_m") or 15_000
        )
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
            started = time.perf_counter()
            response = request_with_retry(
                lambda: client.post(
                    f"{self.BASE_URL}/places:searchNearby",
                    headers=self._headers(NEARBY_FIELD_MASK),
                    json=body,
                ),
                label="Places searchNearby",
            )
            response.raise_for_status()
            duration_ms = int((time.perf_counter() - started) * 1000)
            self._record_request(
                "nearby_search",
                duration_ms=duration_ms,
            )
            payload = response.json()
            self._archive_response(
                "nearby_search",
                request=body,
                response=payload,
                duration_ms=duration_ms,
            )
            return payload

    @staticmethod
    def _skip_place(place: dict[str, Any]) -> bool:
        """Unconditional discovery drops (never become a lead row).

        CLOSED_PERMANENTLY and pure service-area businesses (no physical premise to
        clean) can never yield a callable on-site decision-maker for exterior work.
        CLOSED_TEMPORARILY is *not* dropped here — Google's temporary-closed flag is
        often stale/false-positive on live storefronts, so it is routed to a soft dud
        with a reopen window in resolve/dud_gate.py instead of a silent permanent drop.
        """
        if place.get("businessStatus") == "CLOSED_PERMANENTLY":
            return True
        if place.get("pureServiceAreaBusiness") is True:
            return True
        return False

    @staticmethod
    def _review_stats(reviews: list[Any] | None) -> dict[str, int | float] | None:
        if not reviews:
            return None
        now = datetime.now(tz=UTC)
        ages: list[int] = []
        text_lens: list[int] = []
        for review in reviews[:5]:
            if not isinstance(review, dict):
                continue
            text = str((review.get("text") or {}).get("text") or review.get("text") or "")
            text_lens.append(len(text))
            publish = review.get("publishTime") or review.get("relativePublishTimeDescription")
            if isinstance(publish, str) and "T" in publish:
                try:
                    published = datetime.fromisoformat(publish.replace("Z", "+00:00"))
                    ages.append(max(0, (now - published).days))
                except ValueError:
                    continue
        if not ages and not text_lens:
            return {"count": len(reviews), "newest_review_days_ago": 0, "avg_text_len": 0}
        return {
            "count": len(reviews),
            "newest_review_days_ago": min(ages) if ages else 0,
            "oldest_of_5_days_ago": max(ages) if ages else 0,
            "avg_text_len": sum(text_lens) / len(text_lens) if text_lens else 0,
        }

    @staticmethod
    def _text_field(value: Any) -> str | None:
        if isinstance(value, dict):
            return str(value.get("text") or "") or None
        if isinstance(value, str):
            return value or None
        return None

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

        plus = place.get("plusCode") or {}
        plus_code = plus.get("globalCode") if isinstance(plus, dict) else None
        opening = place.get("regularOpeningHours")
        reviews = place.get("reviews") if isinstance(place.get("reviews"), list) else None

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
            business_status=place.get("businessStatus"),
            rating=float(place["rating"]) if place.get("rating") is not None else None,
            user_rating_count=int(place["userRatingCount"])
            if place.get("userRatingCount") is not None
            else None,
            price_level=str(place.get("priceLevel") or "") or None,
            international_phone=normalize_phone(place.get("internationalPhoneNumber")),
            opening_hours_json=opening if isinstance(opening, dict) else None,
            utc_offset_minutes=int(place["utcOffsetMinutes"])
            if place.get("utcOffsetMinutes") is not None
            else None,
            editorial_summary=self._text_field(place.get("editorialSummary")),
            parking_options=place.get("parkingOptions")
            if isinstance(place.get("parkingOptions"), dict)
            else None,
            payment_options=place.get("paymentOptions")
            if isinstance(place.get("paymentOptions"), dict)
            else None,
            plus_code=str(plus_code) if plus_code else None,
            short_address=place.get("shortFormattedAddress"),
            pure_service_area=place.get("pureServiceAreaBusiness"),
            review_stats=self._review_stats(reviews),
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

    def _market_bbox(self, market: MarketConfig) -> tuple[float, float, float, float] | None:
        raw_bbox = market.get("bbox")
        if raw_bbox and len(raw_bbox) == 4:
            return tuple(float(v) for v in raw_bbox)  # type: ignore[return-value]
        lat = market.get("latitude")
        lng = market.get("longitude")
        if lat is None or lng is None:
            return None
        radius = float(market.get("search_radius_m") or 15_000)
        return market_bbox(lat, lng, radius)

    def _discovery_centers(self, market: MarketConfig) -> list[tuple[float, float, float | None]]:
        """Return (lat, lng, tile_radius_m) search centers for a market."""
        grid_radius = market.get("grid_radius_m")
        if not grid_radius:
            lat = market.get("latitude")
            lng = market.get("longitude")
            if lat is None or lng is None:
                return []
            return [(lat, lng, None)]

        bbox = self._market_bbox(market)
        if bbox is None:
            lat = market.get("latitude")
            lng = market.get("longitude")
            if lat is None or lng is None:
                return []
            return [(lat, lng, float(grid_radius))]

        tile_radius = float(grid_radius)
        return [(lat, lng, tile_radius) for lat, lng in tile_circles(bbox, tile_radius)]

    def _run_query_loop(
        self,
        *,
        market: MarketConfig,
        property_type: str,
        lead_category: str,
        queries: list[str],
        included_type: str | None,
        nearby_types: list[str],
        market_key: str,
        limit: int | None,
        seen_ids: set[str],
        leads: list[RawLead],
        center_lat: float | None = None,
        center_lng: float | None = None,
        radius_m: float | None = None,
    ) -> bool:
        """Run nearby + text searches for one tile. Returns True when limit reached."""
        if nearby_types:
            try:
                nearby_payload = self.search_nearby(
                    market=market,
                    included_types=nearby_types,
                    center_lat=center_lat,
                    center_lng=center_lng,
                    radius_m=radius_m,
                )
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
            return True

        for query in queries:
            page_token: str | None = None
            for _page in range(MAX_PAGES):
                try:
                    payload = self.search_text(
                        query,
                        market=market,
                        included_type=included_type,
                        page_token=page_token,
                        center_lat=center_lat,
                        center_lng=center_lng,
                        radius_m=radius_m,
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
                    return True

                page_token = payload.get("nextPageToken")
                if not page_token:
                    break
                time.sleep(PAGE_DELAY_S)

            if limit and len(leads) >= limit:
                return True
        return False

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

        centers = self._discovery_centers(market)
        if not centers:
            logger.warning("No discovery centers for market %s — missing lat/lng/bbox", market_key)
            return leads

        for center_lat, center_lng, tile_radius in centers:
            if self._run_query_loop(
                market=market,
                property_type=property_type,
                lead_category=lead_category,
                queries=queries,
                included_type=included_type,
                nearby_types=nearby_types,
                market_key=market_key,
                limit=limit,
                seen_ids=seen_ids,
                leads=leads,
                center_lat=center_lat,
                center_lng=center_lng,
                radius_m=tile_radius,
            ):
                break

        if limit and len(leads) > limit:
            leads = leads[:limit]

        if self._store and self.request_count:
            self._store.commit_cost_events()

        tile_note = f", {len(centers)} tile(s)" if market.get("grid_radius_m") else ""
        logger.info(
            "Discovered %d unique places for %s / %s in %s, %s (%d Places API request(s)%s)",
            len(leads),
            market_key,
            property_type,
            city,
            state,
            self.request_count,
            tile_note,
        )
        return leads

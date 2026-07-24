from __future__ import annotations

from pathlib import Path

import yaml

from pallares_leads.discover.places import _PLACE_FIELDS, ATMOSPHERE_FIELDS

_PRICING = Path(__file__).resolve().parents[1] / "config" / "pricing.yaml"


def _mask_fields() -> set[str]:
    return {field.strip() for field in _PLACE_FIELDS.split(",") if field.strip()}


def test_mask_has_no_atmosphere_fields() -> None:
    """Atmosphere fields force the Enterprise + Atmosphere SKU ($0.040/req).

    Keep the discovery mask free of them so we stay on Enterprise ($0.035/req).
    If a future field is genuinely needed, add it AND bump config/pricing.yaml.
    """
    overlap = _mask_fields() & ATMOSPHERE_FIELDS
    assert not overlap, f"Atmosphere fields in discovery mask force the pricier SKU: {overlap}"


def test_mask_keeps_the_contact_fields_we_sell() -> None:
    fields = _mask_fields()
    for required in (
        "places.nationalPhoneNumber",
        "places.websiteUri",
        "places.businessStatus",
        "places.pureServiceAreaBusiness",
    ):
        assert required in fields, f"discovery mask lost a load-bearing field: {required}"


def test_pricing_matches_enterprise_sku() -> None:
    """pricing.yaml must reflect the SKU the mask actually bills at (Enterprise = $0.035)."""
    pricing = yaml.safe_load(_PRICING.read_text(encoding="utf-8"))
    places = pricing["google_places"]
    assert places["text_search_usd"] == 0.035
    assert places["nearby_search_usd"] == 0.035

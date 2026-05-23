from __future__ import annotations

import logging
from pallares_leads.enrich.lead_profile import detect_brand, lead_fingerprint
from pallares_leads.schemas import RawLead
from pallares_leads.utils.geohash import encode_geohash

logger = logging.getLogger(__name__)


def dedupe_by_place_id(leads: list[RawLead]) -> list[RawLead]:
    seen: set[str] = set()
    unique: list[RawLead] = []
    for lead in leads:
        if lead.place_id in seen:
            continue
        seen.add(lead.place_id)
        unique.append(lead)
    return unique


def dedupe_by_fingerprint(leads: list[RawLead]) -> tuple[list[RawLead], int]:
    """Drop near-duplicate Google listings (same brand + street + city, different place_id)."""
    seen_places: set[str] = set()
    seen_fingerprints: set[str] = set()
    unique: list[RawLead] = []
    skipped = 0

    for lead in leads:
        if lead.place_id in seen_places:
            skipped += 1
            continue
        fp = lead_fingerprint(lead)
        if fp in seen_fingerprints:
            logger.info(
                "Skipping near-duplicate listing %s (%s) — same fingerprint as prior lead",
                lead.business_name,
                lead.place_id,
            )
            skipped += 1
            continue
        seen_places.add(lead.place_id)
        seen_fingerprints.add(fp)
        unique.append(lead)

    return unique, skipped


def _geohash_key(lead: RawLead) -> str | None:
    if lead.latitude is None or lead.longitude is None:
        return None
    brand = detect_brand(lead.business_name, lead.website)
    gh = encode_geohash(lead.latitude, lead.longitude, precision=7)
    return f"{lead.property_type}:{brand}:{gh}"


def dedupe_by_geohash(leads: list[RawLead]) -> tuple[list[RawLead], int]:
    """Drop listings at the same geo cell + brand (Google duplicate pins)."""
    seen_places: set[str] = set()
    seen_geo: set[str] = set()
    unique: list[RawLead] = []
    skipped = 0

    for lead in leads:
        if lead.place_id in seen_places:
            skipped += 1
            continue
        geo_key = _geohash_key(lead)
        if geo_key and geo_key in seen_geo:
            logger.info(
                "Skipping geohash duplicate %s (%s) — same cell as prior lead",
                lead.business_name,
                lead.place_id,
            )
            skipped += 1
            continue
        seen_places.add(lead.place_id)
        if geo_key:
            seen_geo.add(geo_key)
        unique.append(lead)

    return unique, skipped


def dedupe_leads(leads: list[RawLead]) -> tuple[list[RawLead], int]:
    """Place-id → fingerprint → geohash dedupe."""
    by_place = dedupe_by_place_id(leads)
    total_skipped = len(leads) - len(by_place)
    by_fp, fp_skipped = dedupe_by_fingerprint(by_place)
    total_skipped += fp_skipped
    unique, geo_skipped = dedupe_by_geohash(by_fp)
    total_skipped += geo_skipped
    return unique, total_skipped

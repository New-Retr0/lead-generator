from __future__ import annotations

import logging
import re

from pallares_leads.enrich.lead_profile import detect_brand, lead_fingerprint, registrable_domain
from pallares_leads.schemas import RawLead
from pallares_leads.utils.geohash import encode_geohash
from pallares_leads.utils.normalize import phone_digits

logger = logging.getLogger(__name__)


def _name_tokens(name: str) -> set[str]:
    stop = {"the", "inc", "llc", "corp", "co", "and", "of", "at"}
    tokens = re.findall(r"[a-z0-9]{3,}", name.casefold())
    return {t for t in tokens if t not in stop}


def _names_overlap(a: RawLead, b: RawLead) -> bool:
    ta = _name_tokens(a.business_name)
    tb = _name_tokens(b.business_name)
    if not ta or not tb:
        return False
    return bool(ta & tb)


def _lead_quality_score(lead: RawLead) -> int:
    score = 0
    if lead.website:
        score += 3
    if lead.main_phone:
        score += 2
    if lead.formatted_address:
        score += 1
    if lead.google_maps_url:
        score += 1
    return score


def _union_key(lead: RawLead) -> str | None:
    if lead.main_phone:
        digits = phone_digits(lead.main_phone)
        if len(digits) == 10:
            return f"phone:{digits}"
    domain = registrable_domain(lead.website)
    if domain:
        return f"domain:{domain}"
    return None


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


def dedupe_by_union(leads: list[RawLead]) -> tuple[list[RawLead], int]:
    """Merge duplicate listings that share phone/domain with overlapping business names."""
    kept: list[RawLead] = []
    index_by_key: dict[str, int] = {}
    unions = 0

    for lead in leads:
        key = _union_key(lead)
        if not key:
            kept.append(lead)
            continue

        if key not in index_by_key:
            index_by_key[key] = len(kept)
            kept.append(lead)
            continue

        existing = kept[index_by_key[key]]
        if not _names_overlap(existing, lead):
            kept.append(lead)
            continue

        winner, loser = (
            (existing, lead)
            if _lead_quality_score(existing) >= _lead_quality_score(lead)
            else (lead, existing)
        )
        if winner is not existing:
            kept[index_by_key[key]] = winner

        if loser.place_id not in winner.alternate_place_ids:
            winner.alternate_place_ids.append(loser.place_id)
        if not winner.website and loser.website:
            winner.website = loser.website
        if not winner.main_phone and loser.main_phone:
            winner.main_phone = loser.main_phone
        unions += 1
        logger.info(
            "Union duplicate %s (%s) into %s (%s) via %s",
            loser.business_name,
            loser.place_id,
            winner.business_name,
            winner.place_id,
            key,
        )

    return kept, unions


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
    """Place-id → fingerprint → union → geohash dedupe."""
    by_place = dedupe_by_place_id(leads)
    total_skipped = len(leads) - len(by_place)
    by_fp, fp_skipped = dedupe_by_fingerprint(by_place)
    total_skipped += fp_skipped
    by_union, union_count = dedupe_by_union(by_fp)
    total_skipped += union_count
    unique, geo_skipped = dedupe_by_geohash(by_union)
    total_skipped += geo_skipped
    return unique, total_skipped

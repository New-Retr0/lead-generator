"""Build flat ML-ready feature snapshots at enrichment time."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

from pallares_leads.enrich.apply import _ROLE_PRIORITY, _role_priority_rank
from pallares_leads.enrich.contact_requirements import is_callable_phone
from pallares_leads.enrich.contacts_format import primary_phone
from pallares_leads.schemas import EnrichedLead, NOT_FOUND

FEATURE_VERSION = 1

_FRANCHISE_DOMAINS = frozenset(
    {
        "mcdonalds.com",
        "subway.com",
        "starbucks.com",
        "walmart.com",
        "target.com",
        "7-eleven.com",
        "circlek.com",
        "shell.com",
        "chevron.com",
        "bp.com",
        "exxon.com",
        "marathon.com",
    }
)
_SOCIAL_HOSTS = frozenset(
    {"facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com", "tiktok.com"}
)


def _website_kind(website: str | None) -> str:
    if not website:
        return "none"
    host = (urlparse(website).hostname or "").lower().removeprefix("www.")
    if not host:
        return "none"
    if any(host == d or host.endswith(f".{d}") for d in _FRANCHISE_DOMAINS):
        return "franchise"
    if any(host == d or host.endswith(f".{d}") for d in _SOCIAL_HOSTS):
        return "social_only"
    return "custom_domain"


def _opening_hours_features(opening_hours: dict[str, Any] | None) -> dict[str, int | bool]:
    if not opening_hours:
        return {"days_open_per_week": 0, "open_weekends": False, "is_24h": False}
    periods = opening_hours.get("periods") or []
    open_days: set[int] = set()
    open_weekends = False
    is_24h = False
    for period in periods:
        if not isinstance(period, dict):
            continue
        open_info = period.get("open") or {}
        close_info = period.get("close") or {}
        day = open_info.get("day")
        if day is not None:
            open_days.add(int(day))
            if int(day) in (0, 6):
                open_weekends = True
        open_time = str(open_info.get("time") or "")
        close_time = str(close_info.get("time") or "")
        if open_time == "0000" and close_time in ("2359", "2400", ""):
            is_24h = True
    return {
        "days_open_per_week": len(open_days),
        "open_weekends": open_weekends,
        "is_24h": is_24h,
    }


def _parking_features(parking: dict[str, Any] | None) -> bool:
    if not parking:
        return False
    return bool(parking.get("freeParkingLot") or parking.get("paidParkingLot"))


def _payment_features(payment: dict[str, Any] | None) -> bool:
    if not payment:
        return False
    return bool(payment.get("acceptsCreditCards") or payment.get("acceptsDebitCards"))


def _fact_counts(facts: list[Any]) -> dict[str, int]:
    counts = {"phone": 0, "person": 0, "email": 0, "grounding_rejections": 0}
    for fact in facts:
        kind = getattr(fact, "fact_kind", None)
        if kind is None and isinstance(fact, dict):
            kind = fact.get("fact_kind")
        kind = kind or ""
        verification = getattr(fact, "verification", None) or (
            fact.get("verification") if isinstance(fact, dict) else ""
        )
        if verification == "rejected":
            counts["grounding_rejections"] += 1
            continue
        if kind in counts:
            counts[kind] += 1
    return counts


def _dm_contacts_count(enriched: EnrichedLead) -> int:
    total = 0
    for contact in enriched.site_contacts:
        if _role_priority_rank(contact.label, contact.name) < len(_ROLE_PRIORITY):
            if is_callable_phone(contact.phone) or (contact.email and "@" in contact.email):
                total += 1
    return total


def _best_contact_role_rank(enriched: EnrichedLead) -> int:
    return _role_priority_rank(enriched.best_contact_role, enriched.best_contact_name)


def _discovery_method(raw_query: str) -> str:
    q = (raw_query or "").casefold()
    if q.startswith("overpass:"):
        return "overpass"
    if "nearby" in q:
        return "nearby"
    return "text_search"


def build_feature_snapshot(
    enriched: EnrichedLead,
    *,
    run_id: str | None,
    category_key: str,
    profile_key: str = "",
    used_playbook_fastpath: bool = False,
    owner_record_present: bool = False,
    owner_kind: str = "",
    principals_count: int = 0,
    bbb_rating: str = "",
    bbb_years_in_business: int | None = None,
    tier_reached: str = "",
    stage_durations: dict[str, int] | None = None,
    cost_summary: dict[str, float | int] | None = None,
    grounding_rejections_count: int = 0,
    model: str = "",
) -> dict[str, float | int | bool | str]:
    """Return a flat feature dict (numbers, bools, short strings only)."""
    stage_durations = stage_durations or {}
    cost_summary = cost_summary or {}
    hours_feats = _opening_hours_features(enriched.opening_hours_json)
    fact_counts = _fact_counts(enriched.facts)
    if grounding_rejections_count:
        fact_counts["grounding_rejections"] = max(
            fact_counts["grounding_rejections"], grounding_rejections_count
        )

    phone = primary_phone(enriched)
    phone_ok = is_callable_phone(enriched.best_contact_phone)
    has_direct = phone_ok and enriched.best_contact_phone not in ("", NOT_FOUND)
    has_email = enriched.best_contact_email_or_form not in ("", NOT_FOUND) and "@" in (
        enriched.best_contact_email_or_form or ""
    )

    now = datetime.now(tz=UTC)
    found_dt = datetime.combine(enriched.date_found, datetime.min.time(), tzinfo=UTC)
    days_first_seen = max(0, (now.date() - found_dt.date()).days)

    features: dict[str, float | int | bool | str] = {
        "feature_version": FEATURE_VERSION,
        "category_key": category_key or enriched.lead_category,
        "market_key": enriched.market_key or "",
        "discovery_method": _discovery_method(enriched.discovery_query),
        "business_status": enriched.business_status or "",
        "primary_type": enriched.google_types[0] if enriched.google_types else "",
        "google_types_count": len(enriched.google_types),
        "rating": float(enriched.rating) if enriched.rating is not None else 0.0,
        "user_rating_count": int(enriched.user_rating_count or 0),
        "price_level": enriched.price_level or "",
        "has_website": bool(enriched.website),
        "website_kind": _website_kind(enriched.website),
        "phone_source": "google"
        if enriched.main_phone and phone == enriched.main_phone
        else ("scrape" if is_callable_phone(phone) else "none"),
        "has_intl_phone": bool(enriched.international_phone),
        "osm_area_m2": float(enriched.osm_area_m2 or 0),
        "days_open_per_week": int(hours_feats["days_open_per_week"]),
        "open_weekends": bool(hours_feats["open_weekends"]),
        "is_24h": bool(hours_feats["is_24h"]),
        "has_parking_lot": _parking_features(enriched.parking_options),
        "accepts_credit_cards": _payment_features(enriched.payment_options),
        "has_editorial_summary": bool(enriched.editorial_summary),
        "newest_review_days_ago": int(
            (enriched.review_stats or {}).get("newest_review_days_ago") or 0
        ),
        "pure_service_area": bool(enriched.pure_service_area),
        "verification_level": enriched.verification_level or "unverified",
        "confidence": enriched.confidence.value,
        "lead_score": int(enriched.lead_score or 0),
        "best_contact_role_rank": _best_contact_role_rank(enriched),
        "site_contacts_count": len(enriched.site_contacts),
        "dm_contacts_count": _dm_contacts_count(enriched),
        "has_email": has_email,
        "has_direct_phone": has_direct,
        "evidence_urls_count": len(enriched.evidence_urls),
        "facts_count_phone": fact_counts["phone"],
        "facts_count_person": fact_counts["person"],
        "facts_count_email": fact_counts["email"],
        "grounding_rejections_count": fact_counts["grounding_rejections"],
        "profile_key": profile_key,
        "used_playbook_fastpath": used_playbook_fastpath,
        "owner_record_present": owner_record_present,
        "owner_kind": owner_kind or "",
        "principals_count": principals_count,
        "bbb_rating": bbb_rating or "",
        "bbb_years_in_business": int(bbb_years_in_business or 0),
        "source_tool": enriched.source_tool or "",
        "tier_reached": tier_reached or "",
        "credits_total": int(cost_summary.get("credits_total") or 0),
        "usd_total": float(cost_summary.get("usd_total") or 0),
        "enrich_duration_ms": int(cost_summary.get("enrich_duration_ms") or 0),
        "found_dow": enriched.date_found.weekday(),
        "found_hour": now.hour,
        "days_first_seen_to_enriched": days_first_seen,
        "model": model or "",
    }

    for key, value in enriched.score_breakdown.items():
        features[f"score_{key}"] = int(value)

    for stage, ms in stage_durations.items():
        features[f"duration_ms_{stage}"] = int(ms)

    return features

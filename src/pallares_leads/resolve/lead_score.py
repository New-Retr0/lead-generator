from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import yaml

from pallares_leads.enrich.contact_requirements import is_callable_phone
from pallares_leads.enrich.contacts_format import primary_phone
from pallares_leads.eval.score import copy_score, exterior_score, source_diversity
from pallares_leads.intelligence.features import build_feature_snapshot
from pallares_leads.resolve.triggers import compute_trigger
from pallares_leads.schemas import NOT_FOUND, EnrichedLead
from pallares_leads.settings import get_settings

_DECISION_ROLES: tuple[str, ...] = (
    "facilities manager",
    "facilities",
    "maintenance manager",
    "maintenance supervisor",
    "maintenance",
    "property manager",
    "property management",
    "property owner",
    "property_owner",
    "owner",
    "landlord",
    "general manager",
    "gm",
    "leasing manager",
    "leasing",
    "portfolio",
    "registered agent",
    "registered_agent",
    "cre broker",
    "cre_broker",
    "broker",
)

_PROPERTY_TICKET_WEIGHTS: dict[str, int] = {
    "parking_large_private": 20,
    "parking": 15,
    "parking_small": 10,
    "strip_mall": 18,
    "shopping_center": 18,
    "industrial": 16,
    "big_box": 15,
    "hotel": 14,
    "medical_plaza": 12,
    "public_agency": 12,
    "gas_station": 8,
    "fast_food": 6,
    "pharmacy": 6,
    "bank": 6,
    "restaurant": 5,
    "thrift_store": 5,
    "community_facility": 8,
    "amusement_facility": 10,
}


def _role_matches(text: str) -> bool:
    lowered = text.casefold()
    return any(token in lowered for token in _DECISION_ROLES)


def _contact_role_score(enriched: EnrichedLead) -> int:
    role = (enriched.best_contact_role or "").lower()
    contact_type = (enriched.best_contact_type or "").lower()
    if _role_matches(role) or _role_matches(contact_type):
        phone = primary_phone(enriched)
        if is_callable_phone(phone) or (
            enriched.best_contact_email_or_form not in ("", NOT_FOUND)
            and "@" in enriched.best_contact_email_or_form
        ):
            return 40

    if role in ("", NOT_FOUND.lower()) and contact_type in ("", NOT_FOUND.lower()):
        for contact in enriched.site_contacts:
            label = (contact.label or "").lower()
            if _role_matches(label) or _role_matches(contact.name):
                if is_callable_phone(contact.phone) or (contact.email and "@" in contact.email):
                    return 40
        phone = primary_phone(enriched)
        if is_callable_phone(phone):
            if _role_matches(enriched.notes or ""):
                return 25
            return 5
        return 0

    phone = primary_phone(enriched)
    if is_callable_phone(phone):
        return 25
    email = enriched.best_contact_email_or_form
    if email not in ("", NOT_FOUND) and "@" in email:
        return 15
    if email not in ("", NOT_FOUND) and "form" in email.lower():
        return 8
    return 0


def _ticket_size_score(enriched: EnrichedLead) -> int:
    base = _PROPERTY_TICKET_WEIGHTS.get(enriched.property_type, 8)
    if enriched.osm_area_m2:
        if enriched.osm_area_m2 >= 8_000:
            base = max(base, 20)
        elif enriched.osm_area_m2 >= 4_000:
            base = max(base, 14)
        elif enriched.osm_area_m2 >= 500:
            base = max(base, 10)
    return min(base, 25)


def _load_learned_coefficients(config_dir: Path) -> dict[str, Any] | None:
    path = config_dir / "learned_score.yaml"
    if not path.is_file():
        return None
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except OSError:
        return None
    coefs = data.get("coefficients") or {}
    labeled = int(data.get("labeled_count") or 0)
    gate = int(data.get("min_labels_gate") or 150)
    if labeled < gate or not coefs:
        return None
    return data


def _learned_p_win(enriched: EnrichedLead) -> float | None:
    settings = get_settings()
    if settings.learned_score_weight <= 0:
        return None
    model = _load_learned_coefficients(settings.config_dir)
    if not model:
        return None
    features = build_feature_snapshot(
        enriched,
        run_id=None,
        category_key=enriched.lead_category,
    )
    coefs: dict[str, float] = model.get("coefficients") or {}
    intercept = float(model.get("intercept") or 0.0)
    logit = intercept
    for key, weight in coefs.items():
        raw = features.get(key, 0)
        if isinstance(raw, bool):
            raw = int(raw)
        if isinstance(raw, str):
            continue
        try:
            logit += float(weight) * float(raw)
        except (TypeError, ValueError):
            continue
    # logistic sigmoid
    try:
        return 1.0 / (1.0 + math.exp(-logit))
    except OverflowError:
        return 1.0 if logit > 0 else 0.0


def compute_lead_score(enriched: EnrichedLead) -> int:
    """Composite lead quality score 0–100 with transparent component breakdown."""
    trigger_score, why_now = compute_trigger(enriched)
    if why_now and not enriched.why_now:
        enriched.why_now = why_now

    level = enriched.verification_level or "unverified"
    confidence_bonus = {"verified": 8, "partial": 4, "unverified": 0}.get(
        level,
        {"High": 8, "Medium": 4, "Low": 0}.get(enriched.confidence.value, 0),
    )

    components: dict[str, int] = {
        "contact": _contact_role_score(enriched),
        "ticket": _ticket_size_score(enriched),
        "trigger": trigger_score,
        "evidence": min(source_diversity(enriched) * 5, 10),
        "copy": min(copy_score(enriched) * 4, 8),
        "exterior": min(exterior_score(enriched) * 3, 8),
        "confidence": confidence_bonus,
    }
    if enriched.sales_status() == "Ready to call":
        components["ready"] = 5

    enriched.score_breakdown = components
    heuristic = sum(components.values())
    heuristic = max(0, min(100, heuristic))
    settings = get_settings()
    p_win = _learned_p_win(enriched)
    if p_win is not None and settings.learned_score_weight > 0:
        weight = min(1.0, max(0.0, settings.learned_score_weight))
        blended = round((1.0 - weight) * heuristic + weight * 100.0 * p_win)
        components["learned_blend"] = blended - heuristic
        enriched.score_breakdown = components
        return max(0, min(100, blended))
    return heuristic


def is_decision_maker_contact(enriched: EnrichedLead) -> bool:
    """True when the best contact looks like a property decision-maker."""
    role = (enriched.best_contact_role or "").lower()
    if _role_matches(role) or _role_matches(enriched.best_contact_type or ""):
        return True
    for contact in enriched.site_contacts:
        label = (contact.label or "").lower()
        if _role_matches(label) or _role_matches(contact.name):
            if is_callable_phone(contact.phone) or (contact.email and "@" in contact.email):
                return True
    return False

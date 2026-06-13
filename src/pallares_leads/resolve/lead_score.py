from __future__ import annotations

from pallares_leads.enrich.contact_requirements import is_callable_phone
from pallares_leads.enrich.contacts_format import primary_phone
from pallares_leads.eval.score import copy_score, exterior_score, source_diversity
from pallares_leads.resolve.triggers import compute_trigger
from pallares_leads.schemas import NOT_FOUND, EnrichedLead

_DECISION_ROLES = (
    "owner",
    "property owner",
    "property_owner",
    "property manager",
    "property_manager",
    "facilities",
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


def _contact_role_score(enriched: EnrichedLead) -> int:
    role = (enriched.best_contact_role or "").lower()
    if role in ("", NOT_FOUND.lower()):
        for contact in enriched.site_contacts:
            label = (contact.label or "").lower()
            if any(token in label for token in _DECISION_ROLES):
                if is_callable_phone(contact.phone) or (contact.email and "@" in contact.email):
                    return 40
        phone = primary_phone(enriched)
        if is_callable_phone(phone):
            if any(token in (enriched.notes or "").lower() for token in _DECISION_ROLES):
                return 25
            return 5
        return 0

    if any(token in role for token in _DECISION_ROLES):
        phone = primary_phone(enriched)
        if is_callable_phone(phone) or (
            enriched.best_contact_email_or_form not in ("", NOT_FOUND)
            and "@" in enriched.best_contact_email_or_form
        ):
            return 40

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
    total = sum(components.values())
    return max(0, min(100, total))


def is_decision_maker_contact(enriched: EnrichedLead) -> bool:
    """True when the best contact looks like a property decision-maker."""
    role = (enriched.best_contact_role or "").lower()
    if any(token in role for token in _DECISION_ROLES):
        return True
    for contact in enriched.site_contacts:
        label = (contact.label or "").lower()
        if any(token in label for token in _DECISION_ROLES):
            if is_callable_phone(contact.phone) or (contact.email and "@" in contact.email):
                return True
    return False

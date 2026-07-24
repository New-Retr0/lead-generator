from __future__ import annotations

from pallares_leads.enrich.contact_requirements import (
    DM_REQUIRED_PROPERTY_TYPES,
    is_callable_phone,
    is_junk_role,
    is_local_callable_phone,
    is_toll_free_phone,
)
from pallares_leads.enrich.contacts_format import primary_phone
from pallares_leads.eval.score import exterior_score, source_diversity
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
    "principal",
    "director",
    "general manager",
    "maintenance",
    "landlord",
)

_PROPERTY_TICKET_WEIGHTS: dict[str, int] = {
    "property_manager": 20,
    "parking_large_private": 20,
    "parking": 15,
    "parking_small": 10,
    "strip_mall": 18,
    "shopping_center": 18,
    "industrial": 16,
    "big_box": 15,
    "hotel": 14,
    "hoa": 14,
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
    if role in ("", NOT_FOUND.lower()) or is_junk_role(role):
        for contact in enriched.site_contacts:
            label = (contact.label or "").lower()
            if is_junk_role(label):
                continue
            if any(token in label for token in _DECISION_ROLES):
                if is_local_callable_phone(contact.phone) or (
                    contact.email and "@" in contact.email
                ):
                    return 40
        phone = primary_phone(enriched)
        if is_local_callable_phone(phone):
            if any(token in (enriched.notes or "").lower() for token in _DECISION_ROLES):
                return 25
            return 5
        return 0

    if any(token in role for token in _DECISION_ROLES):
        phone = primary_phone(enriched)
        if is_local_callable_phone(phone) or (
            enriched.best_contact_email_or_form not in ("", NOT_FOUND)
            and "@" in enriched.best_contact_email_or_form
        ):
            return 40

    phone = primary_phone(enriched)
    if is_local_callable_phone(phone):
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


def _google_main_line_only(enriched: EnrichedLead) -> bool:
    """True when the only dialable number is the Google listing main line."""
    if not is_callable_phone(enriched.main_phone):
        return False
    if is_local_callable_phone(enriched.best_contact_phone):
        main_digits = "".join(c for c in (enriched.main_phone or "") if c.isdigit())[-10:]
        best_digits = "".join(c for c in (enriched.best_contact_phone or "") if c.isdigit())[-10:]
        if best_digits and best_digits != main_digits:
            return False
        # Same as Google — still main-line-only unless a named DM site contact differs.
    for contact in enriched.site_contacts:
        if contact.name.strip() and is_local_callable_phone(contact.phone):
            contact_digits = "".join(c for c in contact.phone if c.isdigit())[-10:]
            main_digits = "".join(c for c in (enriched.main_phone or "") if c.isdigit())[-10:]
            if contact_digits != main_digits:
                return False
    return True


def compute_lead_score(enriched: EnrichedLead) -> int:
    """Composite lead quality score 0–100 weighted for closeability (verified DM + ticket)."""
    trigger_score, why_now = compute_trigger(enriched)
    if why_now and not enriched.why_now:
        enriched.why_now = why_now

    level = enriched.verification_level or "unverified"
    confidence_bonus = {"verified": 12, "partial": 4, "unverified": 0}.get(
        level,
        {"High": 8, "Medium": 4, "Low": 0}.get(enriched.confidence.value, 0),
    )

    components: dict[str, int] = {
        "contact": _contact_role_score(enriched),
        "ticket": _ticket_size_score(enriched),
        "trigger": trigger_score,
        "evidence": min(source_diversity(enriched) * 5, 10),
        "exterior": min(exterior_score(enriched) * 3, 8),
        "confidence": confidence_bonus,
    }

    if is_decision_maker_contact(enriched) and level == "verified":
        components["verified_dm"] = 10

    if (
        enriched.property_type in DM_REQUIRED_PROPERTY_TYPES
        and _google_main_line_only(enriched)
        and not is_decision_maker_contact(enriched)
    ):
        components["google_only_penalty"] = -15

    phone = primary_phone(enriched)
    if is_toll_free_phone(phone):
        components["toll_free_penalty"] = -8

    if enriched.sales_status() == "Verified":
        components["verified"] = 8

    enriched.score_breakdown = components
    return max(0, min(100, sum(components.values())))


def is_decision_maker_contact(enriched: EnrichedLead) -> bool:
    """True when the best contact looks like a property decision-maker (not reception)."""
    role = (enriched.best_contact_role or "").lower()
    if role and not is_junk_role(role) and any(token in role for token in _DECISION_ROLES):
        return True
    for contact in enriched.site_contacts:
        label = (contact.label or "").lower()
        if is_junk_role(label):
            continue
        if any(token in label for token in _DECISION_ROLES):
            if is_local_callable_phone(contact.phone) or (contact.email and "@" in contact.email):
                return True
        # Named contact with facilities-ish label also counts.
        if contact.name.strip() and is_local_callable_phone(contact.phone):
            if any(token in label for token in _DECISION_ROLES) or "manager" in label:
                return True
    return False

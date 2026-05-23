from __future__ import annotations

from pallares_leads.schemas import ExtractedContact

# Multi-tenant / broker targets — PM and facilities first
HIERARCHY: list[str] = [
    "facilities",
    "property_manager",
    "leasing",
    "regional",
    "general_manager",
    "contact_form",
    "generic_email",
    "generic_phone",
]

# Franchise location intro — store/GM line is acceptable entry point
FRANCHISE_HIERARCHY: list[str] = [
    "general_manager",
    "regional",
    "facilities",
    "property_manager",
    "leasing",
    "contact_form",
    "generic_email",
    "generic_phone",
]

_FRANCHISE_PROPERTY_TYPES = frozenset({
    "gas_station",
    "fast_food",
    "grocery",
    "pharmacy",
    "bank",
    "restaurant",
    "big_box",
    "dollar_store",
})


def hierarchy_for(property_type: str) -> list[str]:
    if property_type in _FRANCHISE_PROPERTY_TYPES:
        return FRANCHISE_HIERARCHY
    return HIERARCHY


def rank_contact(contact: ExtractedContact, *, property_type: str = "") -> int:
    order = hierarchy_for(property_type)
    try:
        return order.index(contact.contact_type)
    except ValueError:
        return len(order)


def pick_best_contact(
    contacts: list[ExtractedContact],
    *,
    property_type: str = "",
) -> ExtractedContact | None:
    if not contacts:
        return None
    return min(contacts, key=lambda c: rank_contact(c, property_type=property_type))


def contact_to_fields(contact: ExtractedContact | None) -> dict[str, str]:
    if not contact:
        return {
            "best_contact_type": "Not found",
            "best_contact_name": "Not found",
            "best_contact_role": "Not found",
            "best_contact_phone": "Not found",
            "best_contact_email_or_form": "Not found",
            "contact_source_url": "Not found",
        }
    return {
        "best_contact_type": contact.contact_type.replace("_", " "),
        "best_contact_name": contact.name or "Not found",
        "best_contact_role": contact.role or "Not found",
        "best_contact_phone": contact.phone or "Not found",
        "best_contact_email_or_form": contact.email_or_form or "Not found",
        "contact_source_url": contact.source_url or "Not found",
    }

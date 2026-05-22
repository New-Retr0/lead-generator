from __future__ import annotations

from pallares_leads.schemas import ExtractedContact

# Priority order — lower index wins
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


def rank_contact(contact: ExtractedContact) -> int:
    try:
        return HIERARCHY.index(contact.contact_type)
    except ValueError:
        return len(HIERARCHY)


def pick_best_contact(contacts: list[ExtractedContact]) -> ExtractedContact | None:
    if not contacts:
        return None
    return min(contacts, key=rank_contact)


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

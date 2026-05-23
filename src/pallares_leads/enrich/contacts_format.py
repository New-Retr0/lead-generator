from __future__ import annotations

from pallares_leads.enrich.contact_requirements import is_callable_phone
from pallares_leads.schemas import EnrichedLead, NOT_FOUND, SiteContact

_PRIORITY_ORDER = {"best": 0, "good": 1, "fallback": 2}


def _sorted_contacts(contacts: list[SiteContact]) -> list[SiteContact]:
    return sorted(
        contacts,
        key=lambda c: (_PRIORITY_ORDER.get(c.priority, 3), c.label, c.name),
    )


def _format_contact_line(contact: SiteContact) -> str:
    label = contact.label or "Contact"
    parts: list[str] = [label]
    if contact.name:
        parts.append(contact.name)
    if contact.phone:
        parts.append(contact.phone)
    if contact.email and "@" in contact.email:
        parts.append(contact.email)
    elif contact.email:
        parts.append(contact.email)
    prefix = "★ " if contact.priority == "best" else ""
    return prefix + " — ".join(parts)


def format_contacts_block(lead: EnrichedLead) -> str:
    """Multi-line contacts for sales — label, name, phone, email per line."""
    lines: list[str] = []
    for contact in _sorted_contacts(lead.site_contacts):
        line = _format_contact_line(contact)
        if line.strip("★ ").strip():
            lines.append(line)

    if not lines:
        role = lead.best_contact_role if lead.best_contact_role != NOT_FOUND else ""
        name = lead.best_contact_name if lead.best_contact_name != NOT_FOUND else ""
        phone = lead.best_contact_phone if lead.best_contact_phone != NOT_FOUND else ""
        email = lead.best_contact_email_or_form if lead.best_contact_email_or_form != NOT_FOUND else ""

        parts: list[str] = []
        if role or name:
            if role:
                parts.append(role)
            if name:
                parts.append(name)
            if phone:
                parts.append(phone)
            if email:
                parts.append(email)
            lines.append(" — ".join(parts))
        elif phone:
            lines.append(f"Main line — {phone}")
        elif email:
            lines.append(email)

    return "\n".join(lines)


def primary_phone(lead: EnrichedLead) -> str:
    for contact in _sorted_contacts(lead.site_contacts):
        if contact.phone and is_callable_phone(contact.phone):
            return contact.phone
    if is_callable_phone(lead.best_contact_phone):
        return lead.best_contact_phone
    if is_callable_phone(lead.main_phone):
        return lead.main_phone or ""
    return ""

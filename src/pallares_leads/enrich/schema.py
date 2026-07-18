from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from pallares_leads.schemas import RawLead, SiteContact

_CONTACT_ITEM_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "label": {
            "type": "string",
            "description": (
                "Who this is and why call them for Pallares exterior-services brokerage "
                "(facilities, property manager, leasing, GM) — not patient lines"
            ),
        },
        "name": {"type": "string", "description": "Person's name if known"},
        "phone": {"type": "string", "description": "Direct phone or department line"},
        "email": {"type": "string", "description": "Email if listed"},
        "priority": {
            "type": "string",
            "description": "best = top choice for exterior cleaning outreach; good; fallback",
        },
    },
}

_LEAD_CONTACT_PROPERTIES: dict[str, Any] = {
    "site_contacts": {
        "type": "array",
        "items": _CONTACT_ITEM_SCHEMA,
        "description": (
            "Every reachable contact found on the property website or contact page — "
            "store manager, facilities, GM, department lines, etc. Include phones and "
            "label who is best to call about exterior cleaning."
        ),
    },
    "contact_name": {"type": "string", "description": "Single best person to call (legacy)"},
    "contact_role": {"type": "string", "description": "Their role for the best contact"},
    "contact_phone": {"type": "string", "description": "Best direct phone for outreach"},
    "contact_email": {"type": "string", "description": "Best email or empty if only a form"},
    "contact_form_url": {
        "type": "string",
        "description": "URL of a contact form if no email is listed",
    },
    "property_manager": {
        "type": "string",
        "description": "Property management company or ownership clue if listed",
    },
    "exterior_signals": {
        "type": "string",
        "description": (
            "Exterior maintenance surfaces relevant to Pallares services: parking lot, "
            "concrete, storefront, canopy, dumpster enclosure, drive-through, signage"
        ),
    },
    "recommended_services": {
        "type": "array",
        "items": {"type": "string"},
        "description": (
            "Pallares service fit: parking_lot, storefront, graffiti_removal, recurring_program"
        ),
    },
    "website_url": {
        "type": "string",
        "description": "Official property or business website URL",
    },
    "source_urls": {
        "type": "array",
        "items": {"type": "string"},
        "description": "URLs where information was found",
    },
}

LEAD_CONTACT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": _LEAD_CONTACT_PROPERTIES,
}

LEAD_INVESTIGATION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": _LEAD_CONTACT_PROPERTIES,
}


class LeadInvestigationResult(BaseModel):
    site_contacts: list[SiteContact] = Field(default_factory=list)
    contact_name: str = ""
    contact_role: str = ""
    contact_phone: str = ""
    contact_email: str = ""
    contact_form_url: str = ""
    property_manager: str = ""
    exterior_signals: str = ""
    website_url: str = ""
    source_urls: list[str] = Field(default_factory=list)

    @classmethod
    def from_api_payload(cls, payload: dict[str, Any] | None) -> LeadInvestigationResult | None:
        if not payload:
            return None
        data = (
            payload.get("data")
            if "data" in payload and isinstance(payload.get("data"), dict)
            else payload
        )
        if not isinstance(data, dict):
            return None
        urls = data.get("source_urls") or []
        if not isinstance(urls, list):
            urls = []
        raw_contacts = data.get("site_contacts") or []
        site_contacts: list[SiteContact] = []
        if isinstance(raw_contacts, list):
            for item in raw_contacts:
                if not isinstance(item, dict):
                    continue
                site_contacts.append(
                    SiteContact(
                        label=str(item.get("label") or "").strip(),
                        name=str(item.get("name") or "").strip(),
                        phone=str(item.get("phone") or "").strip(),
                        email=str(item.get("email") or "").strip(),
                        priority=str(item.get("priority") or "").strip().lower(),
                        source_url=str(item.get("source_url") or "").strip(),
                        verification=str(item.get("verification") or "").strip(),
                        quote=str(item.get("quote") or "").strip(),
                    )
                )
        return cls(
            site_contacts=site_contacts,
            contact_name=str(data.get("contact_name") or "").strip(),
            contact_role=str(data.get("contact_role") or "").strip(),
            contact_phone=str(data.get("contact_phone") or "").strip(),
            contact_email=str(data.get("contact_email") or "").strip(),
            contact_form_url=str(data.get("contact_form_url") or "").strip(),
            property_manager=str(data.get("property_manager") or "").strip(),
            exterior_signals=str(data.get("exterior_signals") or "").strip(),
            website_url=str(data.get("website_url") or "").strip(),
            source_urls=[str(u) for u in urls if u],
        )

    def has_usable_contact(self) -> bool:
        for contact in self.site_contacts:
            if contact.phone or (contact.email and "@" in contact.email):
                return True
        if self.contact_phone:
            return True
        if self.contact_email and "@" in self.contact_email:
            return True
        if self.contact_form_url:
            return True
        return False

    def has_rich_contacts(self) -> bool:
        return len(self.site_contacts) > 0 or self.has_usable_contact()


def _location_context(raw: RawLead) -> str:
    state = raw.state or "CA"
    ctx = f"{raw.formatted_address}, {raw.city} {state}"
    if raw.latitude is not None and raw.longitude is not None:
        ctx += f" (near {raw.latitude:.4f}, {raw.longitude:.4f})"
    return ctx


def extract_prompt(raw: RawLead) -> str:
    return (
        f"For {raw.business_name} at {_location_context(raw)} ({raw.lead_category}), scrape "
        f"their website and contact/leasing pages. Return site_contacts: facilities, property "
        f"manager, leasing, GM, or department lines with label, name, phone, email, and priority "
        f"(best/good/fallback) for Pallares exterior-services brokerage outreach. "
        f"Also return property_manager, exterior_signals, recommended_services, website_url, "
        f"and source_urls."
    )

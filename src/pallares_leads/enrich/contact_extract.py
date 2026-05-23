from __future__ import annotations

import logging
import re
from urllib.parse import urljoin, urlparse

from pallares_leads.schemas import ExtractedContact, RawLead
from pallares_leads.utils.normalize import extract_emails, extract_phones

logger = logging.getLogger(__name__)

ROLE_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("facilities", re.compile(r"facilit(y|ies)|maintenance|operations", re.I)),
    ("property_manager", re.compile(r"property\s*manager|asset\s*manager|portfolio", re.I)),
    ("leasing", re.compile(r"leasing|real\s*estate|cre\b", re.I)),
    ("regional", re.compile(r"regional|district|franchise", re.I)),
    ("general_manager", re.compile(r"general\s*manager|\bgm\b|store\s*manager", re.I)),
]

CONTACT_FORM_HINTS = re.compile(r"contact\s*form|get\s*in\s*touch|request\s*a\s*quote", re.I)


def candidate_paths(base_url: str) -> list[str]:
    parsed = urlparse(base_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    paths = ["", "/contact", "/contact-us", "/about", "/about-us", "/locations"]
    return [urljoin(origin + "/", p.lstrip("/")) if p else origin for p in paths]


def extract_contacts_from_markdown(markdown: str, source_url: str) -> list[ExtractedContact]:
    contacts: list[ExtractedContact] = []
    phones = extract_phones(markdown)
    emails = extract_emails(markdown)

    for role_key, pattern in ROLE_PATTERNS:
        if pattern.search(markdown):
            contacts.append(
                ExtractedContact(
                    contact_type=role_key,
                    role=role_key.replace("_", " ").title(),
                    phone=phones[0] if phones else None,
                    email_or_form=emails[0] if emails else None,
                    source_url=source_url,
                )
            )

    if CONTACT_FORM_HINTS.search(markdown):
        contacts.append(
            ExtractedContact(
                contact_type="contact_form",
                role="Contact form",
                email_or_form=f"Contact form ({source_url})",
                source_url=source_url,
            )
        )

    if phones and not contacts:
        contacts.append(
            ExtractedContact(
                contact_type="generic_phone",
                role="Business phone",
                phone=phones[0],
                source_url=source_url,
            )
        )

    if emails and not any(c.email_or_form for c in contacts):
        contacts.append(
            ExtractedContact(
                contact_type="generic_email",
                role="Business email",
                email_or_form=emails[0],
                source_url=source_url,
            )
        )

    return contacts


def merge_page_contacts(pages: list[tuple[str, str]]) -> list[ExtractedContact]:
    all_contacts: list[ExtractedContact] = []
    for url, markdown in pages:
        if not markdown.strip():
            continue
        all_contacts.extend(extract_contacts_from_markdown(markdown, url))
    return all_contacts


def property_manager_clues(markdown: str) -> str | None:
    patterns = [
        r"managed by[:\s]+([^\n\.]{3,80})",
        r"property management[:\s]+([^\n\.]{3,80})",
        r"leased and managed by[:\s]+([^\n\.]{3,80})",
    ]
    for pat in patterns:
        match = re.search(pat, markdown, re.I)
        if match:
            return match.group(1).strip()
    return None


_PROPERTY_SURFACE_DEFAULTS: dict[str, list[str]] = {
    "gas_station": ["parking lot", "canopy/pump island", "concrete"],
    "fast_food": ["drive-thru lane", "storefront", "parking lot"],
    "strip_mall": ["parking lot", "storefronts", "dumpster enclosure"],
    "shopping_center": ["parking lot", "main entries", "dumpster areas"],
    "grocery": ["parking lot", "storefront", "cart corrals"],
    "medical_plaza": ["parking lot", "building facade", "entries"],
    "pharmacy": ["storefront", "parking lot", "drive-through"],
    "bank": ["storefront", "drive-through lane", "walkways"],
    "big_box": ["parking lot", "storefront", "loading dock area"],
    "restaurant": ["patio/storefront", "parking lot", "entries"],
    "property_manager": ["multi-tenant properties", "parking lots", "storefronts"],
    "auto_dealer": ["showroom facade", "lot/concrete", "service drive"],
    "dollar_store": ["storefront", "parking lot", "entries"],
}


def exterior_signals(markdown: str, property_type: str) -> str:
    signals: list[str] = []
    text = markdown.lower()
    keyword_map = {
        "drive-thru": ("drive-thru", "drive through", "drive thru"),
        "canopy/awning": ("canopy", "awning"),
        "parking lot/concrete": ("parking lot", "concrete", "asphalt"),
        "dumpster enclosure": ("dumpster", "enclosure", "trash area"),
        "storefront/facade": ("storefront", "facade", "exterior wall"),
        "oil stains": ("oil stain", "fuel spill"),
        "signage": ("signage", "monument sign"),
    }
    for label, terms in keyword_map.items():
        if any(term in text for term in terms):
            signals.append(label)

    for default in _PROPERTY_SURFACE_DEFAULTS.get(property_type, []):
        signals.append(f"service:{default}")

    if property_type:
        signals.append(f"category:{property_type}")
    return ", ".join(dict.fromkeys(signals))

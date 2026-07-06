from __future__ import annotations

import logging
import re
from urllib.parse import urljoin, urlparse

from pallares_leads.schemas import ExtractedContact
from pallares_leads.utils.normalize import (
    extract_emails_with_positions,
    extract_phones_with_positions,
)

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


# A role keyword and a phone/email only form a labeled contact when they appear
# within this many characters of each other — never pair "first phone on the page".
PAIRING_WINDOW_CHARS = 250


def _window_quote(text: str, center: int, *, span: int = PAIRING_WINDOW_CHARS) -> str:
    start = max(0, center - span)
    end = min(len(text), center + span)
    return " ".join(text[start:end].split()).strip()


def extract_contacts_from_markdown(markdown: str, source_url: str) -> list[ExtractedContact]:
    """Deterministic contact extraction with proximity-window pairing.

    Role-labeled contacts are emitted only when the role keyword and the phone/email
    occur within PAIRING_WINDOW_CHARS of each other; the surrounding window is kept
    as the provenance quote. Everything else degrades honestly to generic facts.
    """
    contacts: list[ExtractedContact] = []
    phone_positions = extract_phones_with_positions(markdown)
    email_positions = extract_emails_with_positions(markdown)
    emails = [e for e, _ in email_positions]

    for role_key, pattern in ROLE_PATTERNS:
        match = pattern.search(markdown)
        if not match:
            continue
        role_pos = match.start()

        near_phone = next(
            (
                p
                for p, pos in phone_positions
                if pos >= 0 and abs(pos - role_pos) <= PAIRING_WINDOW_CHARS
            ),
            None,
        )
        near_email = next(
            (
                e
                for e, pos in email_positions
                if pos >= 0 and abs(pos - role_pos) <= PAIRING_WINDOW_CHARS
            ),
            None,
        )
        if not near_phone and not near_email:
            continue  # role keyword exists but no contact info nearby — do not guess

        contacts.append(
            ExtractedContact(
                contact_type=role_key,
                role=role_key.replace("_", " ").title(),
                phone=near_phone,
                email_or_form=near_email,
                source_url=source_url,
                quote=_window_quote(markdown, role_pos),
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

    paired_phones = {c.phone for c in contacts if c.phone}
    for phone, pos in phone_positions:
        if phone in paired_phones:
            continue
        contacts.append(
            ExtractedContact(
                contact_type="generic_phone",
                role="Business phone",
                phone=phone,
                source_url=source_url,
                quote=_window_quote(markdown, max(pos, 0), span=120),
            )
        )
        break  # one generic phone fact is enough

    if emails and not any(c.email_or_form and "@" in (c.email_or_form or "") for c in contacts):
        email, pos = email_positions[0]
        contacts.append(
            ExtractedContact(
                contact_type="generic_email",
                role="Business email",
                email_or_form=email,
                source_url=source_url,
                quote=_window_quote(markdown, max(pos, 0), span=120),
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
    "strip_mall": ["parking lot", "storefronts", "dumpster enclosure", "sidewalks", "glass storefronts"],
    "outdoor_mall": ["parking lot", "storefronts", "sidewalks", "dumpster pad", "glass storefronts"],
    "shopping_center": ["parking lot", "main entries", "dumpster areas", "sidewalks", "glass storefronts"],
    "coffee_drive_thru": ["drive-thru lane", "storefront", "dumpster pad", "sidewalks"],
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
        "dumpster enclosure": ("dumpster", "enclosure", "trash area", "dumpster pad"),
        "sidewalk/walkways": ("sidewalk", "walkway", "pedestrian path"),
        "glass storefront": ("glass storefront", "storefront glass", "window cleaning"),
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

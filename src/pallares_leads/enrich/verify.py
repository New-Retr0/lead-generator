"""Grounding gate for LLM-extracted lead data.

Every name, phone, and email that an extraction LLM returns must literally appear
in the fetched source text before it is allowed into the pipeline. Anything the
gate cannot ground is stripped and logged — the system never guesses.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

from pallares_leads.enrich.schema import LeadInvestigationResult
from pallares_leads.utils.normalize import is_placeholder_phone, phone_digits

logger = logging.getLogger(__name__)

# Names extraction LLMs commonly invent when a page shows no person.
PLACEHOLDER_NAMES = frozenset(
    {
        "john doe",
        "jane doe",
        "john smith",
        "jane smith",
        "joe bloggs",
        "test test",
        "first last",
        "firstname lastname",
        "your name",
        "full name",
        "lorem ipsum",
        "n/a",
        "na",
        "none",
        "unknown",
        "example",
        "contact name",
        "sample name",
        "not found",
    }
)


@dataclass(frozen=True)
class Rejection:
    """One LLM-claimed value that could not be grounded in source text."""

    kind: str  # name | phone | email
    value: str
    reason: str
    context: str = ""  # e.g. contact label


@dataclass
class GroundingResult:
    result: LeadInvestigationResult
    rejections: list[Rejection] = field(default_factory=list)
    grounded_quotes: dict[str, str] = field(default_factory=dict)  # value -> source snippet


def _squash(text: str) -> str:
    return " ".join(text.split()).casefold()


def is_placeholder_name(name: str) -> bool:
    cleaned = _squash(name)
    return not cleaned or cleaned in PLACEHOLDER_NAMES


def ground_phone(phone: str, page_text: str) -> bool:
    """True when the phone's 10 digits literally appear in the page text."""
    digits = phone_digits(phone)
    if len(digits) != 10 or is_placeholder_phone(phone):
        return False
    page_digits = re.sub(r"\D", "", page_text)
    return digits in page_digits


def ground_email(email: str, page_text: str) -> bool:
    cleaned = email.strip().casefold()
    return bool(cleaned) and "@" in cleaned and cleaned in page_text.casefold()


def ground_name(name: str, page_text: str) -> bool:
    """True when the full person name (>= 2 words, not a placeholder) appears verbatim."""
    cleaned = _squash(name)
    if not cleaned or cleaned in PLACEHOLDER_NAMES:
        return False
    if len(cleaned.split()) < 2:
        return False
    return cleaned in _squash(page_text)


def _quote_around(value: str, page_text: str, *, window: int = 120) -> str:
    """Verbatim snippet of page text surrounding the grounded value."""
    squashed_page = " ".join(page_text.split())
    idx = squashed_page.casefold().find(_squash(value))
    if idx < 0:
        # Phones may match on digits only — fall back to digit search.
        digits = phone_digits(value)
        if len(digits) == 10:
            pattern = re.compile(r"[\d\(\)\.\-\s\+]{10,20}")
            for match in pattern.finditer(squashed_page):
                if digits in re.sub(r"\D", "", match.group()):
                    idx = match.start()
                    break
    if idx < 0:
        return ""
    start = max(0, idx - window)
    end = min(len(squashed_page), idx + len(value) + window)
    return squashed_page[start:end].strip()


def ground_investigation(
    result: LeadInvestigationResult,
    page_text: str,
    *,
    source_label: str = "",
) -> GroundingResult:
    """Strip every name/phone/email the LLM returned that is not present in page_text.

    Phones must digit-match, emails exact-match, names whole-name-match. Labels/roles
    are kept (they describe a department, not a fabricated person) but a contact whose
    name fails grounding loses the name, and a contact with nothing grounded is dropped.
    """
    rejections: list[Rejection] = []
    quotes: dict[str, str] = {}

    def check_phone(phone: str, context: str) -> str:
        if not phone.strip():
            return ""
        if ground_phone(phone, page_text):
            quotes[phone] = _quote_around(phone, page_text)
            return phone.strip()
        rejections.append(
            Rejection(
                kind="phone",
                value=phone,
                context=context,
                reason=f"phone not present in source {source_label}".strip(),
            )
        )
        return ""

    def check_email(email: str, context: str) -> str:
        if not email.strip():
            return ""
        if ground_email(email, page_text):
            quotes[email] = _quote_around(email, page_text)
            return email.strip()
        rejections.append(
            Rejection(
                kind="email",
                value=email,
                context=context,
                reason=f"email not present in source {source_label}".strip(),
            )
        )
        return ""

    def check_name(name: str, context: str) -> str:
        if not name.strip():
            return ""
        if ground_name(name, page_text):
            quotes[name] = _quote_around(name, page_text)
            return name.strip()
        reason = (
            "placeholder name"
            if is_placeholder_name(name)
            else f"name not present in source {source_label}".strip()
        )
        rejections.append(Rejection(kind="name", value=name, context=context, reason=reason))
        return ""

    grounded_contacts = []
    for contact in result.site_contacts:
        name = check_name(contact.name, contact.label)
        phone = check_phone(contact.phone, contact.label)
        email = check_email(contact.email, contact.label)
        if not (name or phone or email):
            continue  # nothing grounded — drop the contact entirely
        quote = quotes.get(name) or quotes.get(phone) or quotes.get(email) or ""
        # Literal grounding = source-backed verified; multi-source upgrades to corroborated elsewhere.
        prior = (contact.verification or "").strip()
        stamped = prior if prior in {"verified", "corroborated"} else "verified"
        updated = contact.model_copy(
            update={
                "name": name,
                "phone": phone,
                "email": email,
                "verification": stamped,
                "source_url": contact.source_url or source_label,
                "quote": contact.quote or quote,
            }
        )
        grounded_contacts.append(updated)

    cleaned = result.model_copy(
        update={
            "site_contacts": grounded_contacts,
            "contact_name": check_name(result.contact_name, result.contact_role),
            "contact_phone": check_phone(result.contact_phone, result.contact_role),
            "contact_email": check_email(result.contact_email, result.contact_role),
        }
    )
    if not cleaned.contact_name and result.contact_name:
        # A role without its (rejected) person is just a department hint; keep the role
        # only if some other grounded datum supports the contact.
        if not (cleaned.contact_phone or cleaned.contact_email):
            cleaned = cleaned.model_copy(update={"contact_role": ""})

    for rejection in rejections:
        logger.info(
            "Verification rejected %s %r (%s)%s",
            rejection.kind,
            rejection.value,
            rejection.reason,
            f" [{rejection.context}]" if rejection.context else "",
        )

    return GroundingResult(result=cleaned, rejections=rejections, grounded_quotes=quotes)

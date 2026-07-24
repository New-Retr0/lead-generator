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
    # Contacts whose phone/email grounded but far from the person's name, so we
    # unbound the reachable value from the person (association, not just presence).
    pairing_downgrades: int = 0


# Max distance (chars, in whitespace-collapsed source) between a person's name and a
# phone/email for us to treat them as the same contact. Mirrors the deterministic
# extractor's PAIRING_WINDOW_CHARS so both paths use one notion of "near".
PAIRING_WINDOW_CHARS = 250

# Split HTML into coarse blocks for association grounding (same parent region).
# Intentionally omit td/th so two-column team rows stay one block (split on tr).
_HTML_BLOCK_SPLIT = re.compile(
    r"</(?:p|div|li|tr|section|article|aside|header|footer|main|"
    r"h[1-6]|ul|ol|table|dl|dt|dd|blockquote)\b[^>]*>",
    re.IGNORECASE,
)
_HTML_TAG_RE = re.compile(r"<[^>]+>")


def _squash(text: str) -> str:
    return " ".join(text.split()).casefold()


def _html_blocks(html: str) -> list[str]:
    """Plain-text chunks from block-level HTML regions (nav/footer still included)."""
    blocks: list[str] = []
    for chunk in _HTML_BLOCK_SPLIT.split(html):
        text = " ".join(_HTML_TAG_RE.sub(" ", chunk).split())
        if text:
            blocks.append(text)
    return blocks


def _text_contains_value(haystack: str, value: str, *, is_phone: bool) -> bool:
    if is_phone:
        digits = phone_digits(value)
        if len(digits) != 10:
            return False
        return digits in re.sub(r"\D", "", haystack)
    needle = _squash(value)
    return bool(needle) and needle in _squash(haystack)


def _same_html_block(
    name: str, value: str, html: str, *, is_phone: bool
) -> bool | None:
    """True if name+value share a block, False if both appear but never together, else None."""
    blocks = _html_blocks(html)
    if not blocks:
        return None
    name_idxs = [
        i
        for i, block in enumerate(blocks)
        if _text_contains_value(block, name, is_phone=False)
    ]
    value_idxs = [
        i
        for i, block in enumerate(blocks)
        if _text_contains_value(block, value, is_phone=is_phone)
    ]
    if not name_idxs or not value_idxs:
        return None
    return bool(set(name_idxs) & set(value_idxs))


def _should_unbind_association(
    name: str,
    value: str,
    page_text: str,
    *,
    is_phone: bool,
    page_html: str | None = None,
) -> bool:
    """Unbind when name and reachable value are confidently not the same contact."""
    if page_html and page_html.strip():
        same = _same_html_block(name, value, page_html, is_phone=is_phone)
        if same is True:
            return False
        if same is False:
            return True
    return _confidently_apart(name, value, page_text, is_phone=is_phone)


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


def _occurrences(value: str, squashed_page: str, *, is_phone: bool) -> list[int]:
    """Character indices where ``value`` appears in the whitespace-collapsed page."""
    idxs: list[int] = []
    if is_phone:
        digits = phone_digits(value)
        if len(digits) != 10:
            return idxs
        for match in re.finditer(r"[\d()\.\-\s+]{10,20}", squashed_page):
            if digits in re.sub(r"\D", "", match.group()):
                idxs.append(match.start())
        return idxs
    needle = _squash(value)
    if not needle:
        return idxs
    low = squashed_page.casefold()
    start = 0
    while True:
        found = low.find(needle, start)
        if found < 0:
            break
        idxs.append(found)
        start = found + 1
    return idxs


def _confidently_apart(
    name: str, value: str, page_text: str, *, is_phone: bool, window: int = PAIRING_WINDOW_CHARS
) -> bool:
    """True only when name and value both occur but never within ``window`` chars.

    Detects a phone/email that grounded independently of the person it was attached
    to (e.g. a footer number while the manager is named in a different section).
    Returns False whenever either value cannot be located, so we never unbind on
    doubt — presence-grounded contacts that we simply cannot position stay verified.
    """
    squashed = " ".join(page_text.split())
    name_idx = _occurrences(name, squashed, is_phone=False)
    value_idx = _occurrences(value, squashed, is_phone=is_phone)
    if not name_idx or not value_idx:
        return False
    closest = min(abs(a - b) for a in name_idx for b in value_idx)
    return closest > window


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
    page_html: str | None = None,
) -> GroundingResult:
    """Strip every name/phone/email the LLM returned that is not present in page_text.

    Phones must digit-match, emails exact-match, names whole-name-match. Labels/roles
    are kept (they describe a department, not a fabricated person) but a contact whose
    name fails grounding loses the name, and a contact with nothing grounded is dropped.

    When ``page_html`` is provided, association uses same-DOM-block co-occurrence first,
    then falls back to the markdown proximity window.
    """
    rejections: list[Rejection] = []
    quotes: dict[str, str] = {}
    html = page_html if isinstance(page_html, str) and page_html.strip() else None

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

    pairing_downgrades = 0

    grounded_contacts = []
    for contact in result.site_contacts:
        name = check_name(contact.name, contact.label)
        phone = check_phone(contact.phone, contact.label)
        email = check_email(contact.email, contact.label)
        if not (name or phone or email):
            continue  # nothing grounded — drop the contact entirely

        # Association guard: only assert "this person is reachable at this number"
        # when the name and the phone/email co-occur in the source. A reachable value
        # that grounded far from the name may belong to someone else on the page, so
        # unbind it from the person (business reachability is still carried by the
        # Google main_phone / other contacts) and mark the contact corroborated.
        unpaired = False
        if name and phone and _should_unbind_association(
            name, phone, page_text, is_phone=True, page_html=html
        ):
            phone = ""
            unpaired = True
        if name and email and _should_unbind_association(
            name, email, page_text, is_phone=False, page_html=html
        ):
            email = ""
            unpaired = True
        if not (name or phone or email):
            continue
        if unpaired:
            pairing_downgrades += 1

        quote = quotes.get(name) or quotes.get(phone) or quotes.get(email) or ""
        # Literal grounding = source-backed verified; multi-source upgrades corroborated elsewhere.
        prior = (contact.verification or "").strip()
        if prior in {"verified", "corroborated"}:
            stamped = prior
        elif unpaired:
            stamped = "corroborated"
        else:
            stamped = "verified"
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

    top_name = check_name(result.contact_name, result.contact_role)
    top_phone = check_phone(result.contact_phone, result.contact_role)
    top_email = check_email(result.contact_email, result.contact_role)
    if top_name and top_phone and _should_unbind_association(
        top_name, top_phone, page_text, is_phone=True, page_html=html
    ):
        top_phone = ""
        pairing_downgrades += 1
    if top_name and top_email and _should_unbind_association(
        top_name, top_email, page_text, is_phone=False, page_html=html
    ):
        top_email = ""
        pairing_downgrades += 1

    cleaned = result.model_copy(
        update={
            "site_contacts": grounded_contacts,
            "contact_name": top_name,
            "contact_phone": top_phone,
            "contact_email": top_email,
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
    if pairing_downgrades:
        logger.info(
            "Association grounding unbound %d contact(s): phone/email grounded but "
            "not within %d chars of the person's name%s",
            pairing_downgrades,
            PAIRING_WINDOW_CHARS,
            f" [{source_label}]" if source_label else "",
        )

    return GroundingResult(
        result=cleaned,
        rejections=rejections,
        grounded_quotes=quotes,
        pairing_downgrades=pairing_downgrades,
    )

"""Better Business Bureau profile lookup — deterministic parse, verified facts.

A human SDR's first cross-check: BBB profiles list the real principals
("Mr. Ahmad A. Jaber, President"), entity type, alternate entity names, extra
phone numbers, and an accreditation rating. All of it is parsed with regexes
from the scraped page (no LLM), so every fact is verified at birth and carries
the exact matched line as its provenance quote.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from urllib.parse import urlparse

from pallares_leads.enrich.search_templates import render_search_template
from pallares_leads.enrich.verify import ground_name, ground_phone
from pallares_leads.schemas import LeadFact, RawLead, SiteContact
from pallares_leads.utils.normalize import (
    extract_phones_with_positions,
    normalize_phone,
    slugify,
)

logger = logging.getLogger(__name__)

_PROFILE_PATH = re.compile(r"bbb\.org/us/[a-z]{2}/[^/]+/profile/", re.I)

_RATING = re.compile(r"BBB\s+Rating[:\s]*\n?\s*([A-F][+-]?)(?=[\s\n.,)]|$)")
_ACCREDITED_SINCE = re.compile(r"BBB\s+Accredited\s+Since[:\s]+(\d{1,2}/\d{1,2}/\d{4})", re.I)
_BUSINESS_STARTED = re.compile(r"Business\s+Started[:\s]+(\d{1,2}/\d{1,2}/\d{4})", re.I)
_ENTITY_TYPE = re.compile(r"Type\s+of\s+Entity[:\s]+([^\n|]{3,60})", re.I)
_ALTERNATE_NAMES = re.compile(r"Alternate\s+(?:Business\s+)?Names?[:\s]+([^\n|]{3,120})", re.I)
_YEARS_IN_BUSINESS = re.compile(r"Years\s+in\s+Business[:\s]+(\d{1,3})", re.I)

# "Mr. Ahmad A. Jaber, President" — honorific optional, title after the comma.
_PRINCIPAL_LINE = re.compile(
    r"(?:Mr\.|Mrs\.|Ms\.|Dr\.)?\s*([A-Z][a-zA-Z'\-]+(?:\s+[A-Z]\.?)?(?:\s+[A-Z][a-zA-Z'\-]+)+)\s*,\s*"
    r"(President|Vice President|CEO|CFO|COO|Owner|Co-Owner|Manager|General Manager|"
    r"Managing Member|Member|Partner|Principal|Director|Secretary|Treasurer)",
)
_PRINCIPAL_SECTIONS = re.compile(
    r"(?:Business\s+Management|Principal\s+Contacts?|Customer\s+Contacts?)[:\s]*\n?((?:.+\n?){1,6})",
    re.I,
)
_ADDITIONAL_PHONES = re.compile(
    r"Additional\s+Phone\s+Numbers([\s\S]{0,400}?)(?:Additional|Licensing|Social|Business\s+Categor|$)",
    re.I,
)


@dataclass
class BBBProfile:
    url: str = ""
    rating: str = ""
    accredited_since: str = ""
    business_started: str = ""
    years_in_business: str = ""
    entity_type: str = ""
    alternate_names: list[str] = field(default_factory=list)
    principals: list[tuple[str, str]] = field(default_factory=list)  # (name, title)
    phones: list[str] = field(default_factory=list)
    quotes: dict[str, str] = field(default_factory=dict)  # value -> matched source line

    def has_data(self) -> bool:
        return bool(
            self.rating
            or self.principals
            or self.phones
            or self.alternate_names
            or self.entity_type
        )


def pick_bbb_profile_url(candidates: list[str], business_name: str) -> str | None:
    """Accept only real BBB profile URLs; prefer slugs containing the business name."""
    profile_urls = [u for u in candidates if _PROFILE_PATH.search(u)]
    if not profile_urls:
        return None
    name_slug = slugify(business_name)
    for url in profile_urls:
        path = urlparse(url).path.casefold()
        if name_slug and name_slug in path:
            return url
    # Partial match on the first word of the name (e.g. "jaber" in jaber-motors-…).
    first = name_slug.split("-")[0] if name_slug else ""
    if len(first) >= 4:
        for url in profile_urls:
            if first in urlparse(url).path.casefold():
                return url
    return None


def find_bbb_profile_url(raw: RawLead, search_web, *, config_dir) -> str | None:
    """Locate the BBB profile via Firecrawl search (2 credits per <=10 results)."""
    query = render_search_template(
        "bbb_profile",
        config_dir=config_dir,
        business_name=raw.business_name,
        city=raw.city,
        state=raw.state,
    )
    results = search_web(query, limit=5)
    candidates = [r["url"] for r in results if r.get("url")]
    return pick_bbb_profile_url(candidates, raw.business_name)


def _line_of(markdown: str, offset: int) -> str:
    start = markdown.rfind("\n", 0, offset) + 1
    end = markdown.find("\n", offset)
    if end < 0:
        end = len(markdown)
    return markdown[start:end].strip()


def parse_bbb_profile(markdown: str, url: str = "") -> BBBProfile:
    """Deterministic regex parse of a BBB profile page (markdown)."""
    profile = BBBProfile(url=url)

    for pattern, attr in (
        (_RATING, "rating"),
        (_ACCREDITED_SINCE, "accredited_since"),
        (_BUSINESS_STARTED, "business_started"),
        (_YEARS_IN_BUSINESS, "years_in_business"),
        (_ENTITY_TYPE, "entity_type"),
    ):
        match = pattern.search(markdown)
        if match:
            value = match.group(1).strip()
            setattr(profile, attr, value)
            profile.quotes[value] = _line_of(markdown, match.start()) or match.group(0).strip()

    alt = _ALTERNATE_NAMES.search(markdown)
    if alt:
        names = [n.strip() for n in re.split(r"[;]|\band\b", alt.group(1)) if n.strip()]
        profile.alternate_names = names
        for name in names:
            profile.quotes[name] = _line_of(markdown, alt.start())

    seen_principals: set[tuple[str, str]] = set()
    for section in _PRINCIPAL_SECTIONS.finditer(markdown):
        block = section.group(1)
        for person in _PRINCIPAL_LINE.finditer(block):
            entry = (person.group(1).strip(), person.group(2).strip())
            if entry not in seen_principals:
                seen_principals.add(entry)
                profile.principals.append(entry)
                profile.quotes[entry[0]] = _line_of(markdown, section.start())

    phones_block = _ADDITIONAL_PHONES.search(markdown)
    if phones_block:
        for phone, pos in extract_phones_with_positions(phones_block.group(1)):
            normalized = normalize_phone(phone) or phone
            if normalized not in profile.phones:
                profile.phones.append(normalized)
                profile.quotes[normalized] = (
                    _line_of(phones_block.group(1), pos) or "Additional Phone Numbers"
                )

    return profile


def bbb_profile_to_facts(profile: BBBProfile, *, page_text: str = "") -> list[LeadFact]:
    facts: list[LeadFact] = []

    def fact(kind: str, value: dict[str, str], quote_key: str) -> LeadFact | None:
        quote = profile.quotes.get(quote_key, "")
        verification = "verified"
        if page_text:
            if kind == "person" and not ground_name(value.get("name", ""), page_text):
                verification = "unverified"
            if kind == "phone" and not ground_phone(value.get("phone", ""), page_text):
                verification = "unverified"
        return LeadFact(
            fact_kind=kind,
            value=value,
            source_kind="bbb",
            source_url=profile.url,
            method="deterministic_parse",
            quote=quote,
            verification=verification,
        )

    if profile.rating:
        rating_fact = fact(
            "registry_rating",
            {
                "rating": profile.rating,
                "accredited_since": profile.accredited_since,
                "business_started": profile.business_started,
                "years_in_business": profile.years_in_business,
                "entity_type": profile.entity_type,
            },
            profile.rating,
        )
        if rating_fact:
            facts.append(rating_fact)
    for name, title in profile.principals:
        person_fact = fact("person", {"name": name, "title": title}, name)
        if person_fact:
            facts.append(person_fact)
    for phone in profile.phones:
        phone_fact = fact("phone", {"phone": phone, "label": "BBB additional phone"}, phone)
        if phone_fact:
            facts.append(phone_fact)
    for alt_name in profile.alternate_names:
        alt_fact = fact("alternate_name", {"name": alt_name}, alt_name)
        if alt_fact:
            facts.append(alt_fact)
    return facts


def bbb_contacts(profile: BBBProfile, *, page_text: str = "") -> list[SiteContact]:
    """Principals and additional phones as separate atomic contacts.

    BBB never says which phone belongs to which person, so we never pair them —
    principals are name+title facts ("ask for them"), phones are labeled lines.
    """
    contacts: list[SiteContact] = []
    for name, title in profile.principals:
        verified = not page_text or ground_name(name, page_text)
        contacts.append(
            SiteContact(
                label=title,
                name=name,
                priority="best",
                source_url=profile.url,
                verification="verified" if verified else "unverified",
                quote=profile.quotes.get(name, ""),
            )
        )
    for phone in profile.phones:
        verified = not page_text or ground_phone(phone, page_text)
        contacts.append(
            SiteContact(
                label="BBB additional phone",
                phone=phone,
                priority="good",
                source_url=profile.url,
                verification="verified" if verified else "unverified",
                quote=profile.quotes.get(phone, ""),
            )
        )
    return contacts

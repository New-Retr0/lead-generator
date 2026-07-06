"""Evidence-based verification levels — replaces heuristic confidence for display."""

from __future__ import annotations

from typing import Literal

from pallares_leads.enrich.contact_requirements import is_callable_phone
from pallares_leads.schemas import EnrichedLead

VerificationLevel = Literal["verified", "partial", "unverified"]

_TRUSTED = frozenset({"verified", "corroborated"})


def _verified_person_contacts(enriched: EnrichedLead) -> list:
    people = []
    for c in enriched.site_contacts:
        if not c.name.strip() or c.verification not in _TRUSTED:
            continue
        # Name-only SERP hits (e.g. LinkedIn) do not satisfy verified-person unless corroborated.
        if not c.phone.strip() and c.verification != "corroborated":
            continue
        people.append(c)
    return people


def _verified_phones(enriched: EnrichedLead) -> list[str]:
    phones: list[str] = []
    for c in enriched.site_contacts:
        if is_callable_phone(c.phone) and c.verification in _TRUSTED:
            phones.append(c.phone)
    if not phones and is_callable_phone(enriched.main_phone):
        phones.append(enriched.main_phone)  # type: ignore[arg-type]
    return phones


def compute_verification_level(enriched: EnrichedLead) -> VerificationLevel:
    """Lead-level verification from grounded facts and contacts.

    verified  — callable verified phone AND at least one verified named person
    partial   — callable verified phone but no verified person name
    unverified — no grounded callable contact
    """
    verified_people = _verified_person_contacts(enriched)
    verified_phones = _verified_phones(enriched)

    # BBB/SOS principals in facts count as verified people even if not yet in site_contacts
    if not verified_people:
        for fact in enriched.facts:
            if fact.fact_kind == "person" and fact.verification in _TRUSTED:
                name = fact.value.get("name", "")
                if name:
                    verified_people.append(name)

    if verified_phones and verified_people:
        return "verified"
    if verified_phones:
        return "partial"
    return "unverified"


def verification_to_confidence(level: VerificationLevel) -> str:
    """Map verification_level to legacy Confidence enum values for exports."""
    if level == "verified":
        return "High"
    if level == "partial":
        return "Medium"
    return "Low"


def confidence_bonus(level: VerificationLevel) -> int:
    return {"verified": 8, "partial": 4, "unverified": 0}[level]

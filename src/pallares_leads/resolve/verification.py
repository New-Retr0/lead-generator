"""Evidence-based verification levels — replaces heuristic confidence for display."""

from __future__ import annotations

from typing import Literal

from pallares_leads.enrich.contact_requirements import (
    has_atomic_named_decision_maker,
    is_callable_phone,
)
from pallares_leads.schemas import EnrichedLead

VerificationLevel = Literal["verified", "partial", "unverified"]

_TRUSTED = frozenset({"verified", "corroborated"})


def _has_callable_phone(enriched: EnrichedLead) -> bool:
    """Any dialable phone: trusted site_contact phone or Google main_phone."""
    for contact in enriched.site_contacts:
        if is_callable_phone(contact.phone) and (
            not contact.verification or contact.verification in _TRUSTED
        ):
            return True
    return is_callable_phone(enriched.main_phone)


def compute_verification_level(enriched: EnrichedLead) -> VerificationLevel:
    """Lead-level verification from atomic contacts — same bar as Ready for verified.

    verified  — atomic named decision-maker + local phone (does not require
                verification_level to already be set; BBB/SOS person facts alone
                never upgrade)
    partial   — any callable phone but not an atomic named DM
    unverified — no grounded callable contact
    """
    if has_atomic_named_decision_maker(enriched):
        return "verified"
    if _has_callable_phone(enriched):
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

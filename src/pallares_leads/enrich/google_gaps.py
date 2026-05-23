from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from pallares_leads.enrich.contact_requirements import (
    enriched_meets_bar,
    get_enrichment_rules,
    investigation_meets_bar,
)
from pallares_leads.enrich.schema import LeadInvestigationResult
from pallares_leads.schemas import EnrichedLead, NOT_FOUND, RawLead

# Franchise / locator pages — Google often returns these instead of a local site
CORPORATE_LOCATOR_DOMAINS = (
    "shell.com",
    "chevron.com",
    "76.com",
    "sinclairoil.com",
    "bp.com",
    "exxon.com",
    "mapquest.com",
    "mcdonalds.com",
    "subway.com",
    "starbucks.com",
    "walmart.com",
    "target.com",
    "google.com/maps",
)


@dataclass
class GoogleGaps:
    """Fields Google Places did not provide — Firecrawl should try to fill these."""

    missing_website: bool
    missing_phone: bool
    corporate_website: bool
    missing_contact: bool

    @classmethod
    def from_lead(
        cls,
        raw: RawLead,
        enriched: EnrichedLead | None = None,
        investigation: LeadInvestigationResult | None = None,
        *,
        config_dir: Path | None = None,
    ) -> GoogleGaps:
        rules = get_enrichment_rules(raw.property_type, config_dir)
        website = (enriched.website if enriched and enriched.website else None) or raw.website
        phone = raw.main_phone

        has_contact = False
        if enriched:
            has_contact, _ = enriched_meets_bar(enriched, rules)
        elif investigation:
            has_contact, _ = investigation_meets_bar(
                investigation, rules, property_type=raw.property_type
            )

        return cls(
            missing_website=not bool(website),
            missing_phone=not bool(phone),
            corporate_website=bool(website) and is_corporate_locator_url(website),
            missing_contact=not has_contact,
        )

    def needs_firecrawl_investigation(self, property_type: str, *, config_dir: Path | None = None) -> bool:
        rules = get_enrichment_rules(property_type, config_dir)
        if rules.always_investigate:
            return True
        if self.missing_website or self.missing_phone:
            return True
        if self.corporate_website:
            return True
        if self.missing_contact:
            return True
        return False


def is_corporate_locator_url(url: str) -> bool:
    lower = url.lower()
    return any(domain in lower for domain in CORPORATE_LOCATOR_DOMAINS)


def gap_summary(gaps: GoogleGaps) -> str:
    parts: list[str] = []
    if gaps.missing_website:
        parts.append("website")
    if gaps.missing_phone:
        parts.append("phone")
    if gaps.corporate_website:
        parts.append("local site (corporate locator)")
    if gaps.missing_contact:
        parts.append("decision-maker contact")
    return ", ".join(parts) if parts else "none"

from __future__ import annotations

import logging

from pallares_leads.enrich.firecrawl_client import FirecrawlClient
from pallares_leads.enrich.google_gaps import GoogleGaps, is_corporate_locator_url
from pallares_leads.enrich.schema import LeadInvestigationResult
from pallares_leads.schemas import EnrichedLead, InvestigationStatus, RawLead

logger = logging.getLogger(__name__)


def resolve_website(
    raw: RawLead,
    enriched: EnrichedLead,
    firecrawl: FirecrawlClient,
    gaps: GoogleGaps,
) -> RawLead:
    """Use Firecrawl search when Google Places has no website (or only a corporate locator)."""
    if not gaps.missing_website and not gaps.corporate_website:
        return raw

    reason = "no Google website" if gaps.missing_website else "corporate locator URL"
    logger.info("  Firecrawl gap-fill: finding website (%s)", reason)

    found = firecrawl.search_website(raw)
    if found and not is_corporate_locator_url(found):
        enriched.website = found
        logger.info("  Firecrawl found website: %s", found)
        return raw.model_copy(update={"website": found})

    if gaps.corporate_website and raw.website:
        logger.info("  Keeping Google website for agent follow-up: %s", raw.website)

    return raw


def merge_firecrawl_into_lead(
    enriched: EnrichedLead,
    raw: RawLead,
    investigation: LeadInvestigationResult | None,
) -> None:
    """Copy Firecrawl findings into fields Google Places left empty."""
    if not investigation:
        return

    if not raw.main_phone and investigation.contact_phone:
        enriched.main_phone = investigation.contact_phone

    if enriched.notes.startswith("No website") and enriched.website:
        enriched.notes = "Gap-filled by Firecrawl (not on Google listing)"


def finalize_enrichment_notes(
    enriched: EnrichedLead,
    raw: RawLead,
    gaps: GoogleGaps,
    investigation: LeadInvestigationResult | None,
) -> None:
    filled: list[str] = []
    if gaps.missing_website and enriched.website and not raw.website:
        filled.append("website")
    if gaps.missing_phone and enriched.main_phone and not raw.main_phone:
        filled.append("phone")
    if gaps.missing_contact and investigation and investigation.has_usable_contact():
        filled.append("contact")

    if filled and not enriched.notes:
        enriched.notes = f"Firecrawl gap-fill: {', '.join(filled)}"
    elif filled and enriched.notes.startswith("Gap-filled"):
        enriched.notes = f"Firecrawl gap-fill: {', '.join(filled)}"

    if not enriched.website and not raw.website:
        if not investigation or (
            not investigation.has_usable_contact() and not investigation.website_url
        ):
            enriched.notes = "No website or contact found — needs manual research"
            enriched.investigation_status = InvestigationStatus.NEEDS_MANUAL

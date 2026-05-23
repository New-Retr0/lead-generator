from __future__ import annotations

from pallares_leads.enrich.schema import LeadInvestigationResult
from pallares_leads.schemas import Confidence, EnrichedLead, ExtractedContact


def score_confidence(
    lead: EnrichedLead,
    best: ExtractedContact | None,
    *,
    pages_scraped: int,
    investigation: LeadInvestigationResult | None = None,
) -> Confidence:
    if investigation:
        role = (investigation.contact_role or "").lower()
        if any(k in role for k in ("facilities", "property manager", "leasing")):
            if investigation.contact_phone or (
                investigation.contact_email and "@" in investigation.contact_email
            ):
                return Confidence.HIGH

        if investigation.has_usable_contact():
            return Confidence.MEDIUM

    if best is None and not lead.main_phone:
        return Confidence.LOW

    if best and best.contact_type in {"facilities", "property_manager", "leasing"}:
        if best.phone or (best.email_or_form and "@" in best.email_or_form):
            return Confidence.HIGH

    if best and best.contact_type in {"regional", "general_manager", "generic_email"}:
        return Confidence.MEDIUM

    if lead.main_phone and lead.main_phone != "Not found":
        return Confidence.MEDIUM

    if pages_scraped > 0 or (investigation and investigation.has_usable_contact()):
        return Confidence.LOW

    return Confidence.LOW

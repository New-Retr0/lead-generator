from __future__ import annotations

from pallares_leads.schemas import Confidence, EnrichedLead, ExtractedContact


def score_confidence(
    lead: EnrichedLead,
    best: ExtractedContact | None,
    *,
    pages_scraped: int,
) -> Confidence:
    if best is None and not lead.main_phone:
        return Confidence.LOW

    if best and best.contact_type in {"facilities", "property_manager", "leasing"}:
        if best.phone or (best.email_or_form and "@" in best.email_or_form):
            return Confidence.HIGH

    if best and best.contact_type in {"regional", "general_manager", "generic_email"}:
        return Confidence.MEDIUM

    if lead.main_phone and lead.main_phone != "Not found":
        return Confidence.MEDIUM

    if pages_scraped > 0:
        return Confidence.LOW

    return Confidence.LOW

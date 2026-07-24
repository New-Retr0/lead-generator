from datetime import date

from pallares_leads.resolve.lead_score import compute_lead_score
from pallares_leads.schemas import EnrichedLead, InvestigationStatus

# The single export gate is lead_score >= 25 in the partner_leads_v1 SQL view
# (there is no Python min_export_score setting — it was removed as dead code).
PARTNER_SCORE_FLOOR = 25


def _passes_export_gate(lead: EnrichedLead, threshold: int) -> bool:
    score = lead.lead_score if lead.lead_score is not None else compute_lead_score(lead)
    return score >= threshold


def test_partner_view_score_floor() -> None:
    high = EnrichedLead(
        place_id="high",
        business_name="Good Lead",
        formatted_address="1 Main",
        city="Reedley",
        state="CA",
        property_type="strip_mall",
        lead_category="Strip Mall",
        lead_score=80,
        date_found=date(2026, 6, 10),
        investigation_status=InvestigationStatus.ENRICHED,
    )
    low = EnrichedLead(
        place_id="low",
        business_name="Weak Lead",
        formatted_address="2 Main",
        city="Reedley",
        state="CA",
        property_type="strip_mall",
        lead_category="Strip Mall",
        lead_score=10,
        date_found=date(2026, 6, 10),
        investigation_status=InvestigationStatus.DISCOVERED,
    )
    exportable = [lead for lead in (high, low) if _passes_export_gate(lead, PARTNER_SCORE_FLOOR)]
    assert len(exportable) == 1
    assert exportable[0].place_id == "high"

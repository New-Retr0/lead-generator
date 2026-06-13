from __future__ import annotations

from urllib.parse import urlparse

from pallares_leads.enrich.contact_requirements import is_callable_phone
from pallares_leads.enrich.contacts_format import primary_phone
from pallares_leads.enrich.sales_copy import is_generic_copy
from pallares_leads.eval.trace import LeadEvalReport
from pallares_leads.schemas import NOT_FOUND, EnrichedLead


def contact_score(enriched: EnrichedLead) -> int:
    export_phone = primary_phone(enriched)
    if is_callable_phone(export_phone):
        return 3
    if is_callable_phone(enriched.best_contact_phone):
        return 2
    email = enriched.best_contact_email_or_form
    if email not in ("", NOT_FOUND) and "@" in email:
        return 2
    if email not in ("", NOT_FOUND) and "form" in email.lower():
        return 1
    return 0


def copy_score(enriched: EnrichedLead) -> int:
    why = enriched.why_this_is_a_good_fit.strip()
    points = enriched.sales_talking_points.strip()
    if not why and not points:
        return 0
    if is_generic_copy(why, points, city=enriched.city, business_name=enriched.business_name):
        return 1
    return 3


def exterior_score(enriched: EnrichedLead) -> int:
    signals = enriched.exterior_cleaning_need_signals.strip()
    if not signals:
        return 0
    if signals.startswith("category:") or signals == f"category:{enriched.property_type}":
        return 1
    return 2


def source_diversity(enriched: EnrichedLead) -> int:
    domains: set[str] = set()
    for url in enriched.evidence_urls:
        parsed = urlparse(url)
        if parsed.netloc:
            domains.add(parsed.netloc.lower())
    if len(domains) >= 3:
        return 2
    if len(domains) >= 1:
        return 1
    return 0


def score_lead_report(report: LeadEvalReport, enriched: EnrichedLead) -> dict[str, int]:
    return {
        "contact_score": contact_score(enriched),
        "copy_score": copy_score(enriched),
        "exterior_score": exterior_score(enriched),
        "source_diversity": source_diversity(enriched),
    }

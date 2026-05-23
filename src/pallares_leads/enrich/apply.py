from __future__ import annotations

import logging

from pallares_leads.enrich.contact_requirements import is_callable_phone
from pallares_leads.enrich.domain_verify import pick_verified_website_url, verify_website_url
from pallares_leads.enrich.schema import LeadInvestigationResult
from pallares_leads.schemas import EnrichedLead, InvestigationStatus, NOT_FOUND, RawLead, SiteContact
from pallares_leads.utils.normalize import is_placeholder_phone, normalize_phone, pick_best_phone

logger = logging.getLogger(__name__)


def _valid_site_contacts(contacts: list[SiteContact]) -> list[SiteContact]:
    cleaned: list[SiteContact] = []
    for contact in contacts:
        if contact.phone and not is_callable_phone(contact.phone):
            logger.info("Rejected invalid site contact phone: %s", contact.phone)
            contact = contact.model_copy(update={"phone": ""})
        cleaned.append(contact)
    return cleaned


def _labeled(contact: SiteContact) -> bool:
    return bool(contact.label.strip() or contact.name.strip())


def _apply_site_contacts(enriched: EnrichedLead, result: LeadInvestigationResult) -> None:
    if not result.site_contacts:
        return
    enriched.site_contacts = _valid_site_contacts(result.site_contacts)
    best = next((c for c in enriched.site_contacts if c.priority == "best" and c.phone), None)
    if best is None:
        best = next((c for c in enriched.site_contacts if c.phone), None)
    if best is None:
        return

    if best.label:
        enriched.best_contact_role = best.label
    if best.name:
        enriched.best_contact_name = best.name
    if best.phone:
        merged = pick_best_phone(
            enriched.main_phone,
            (best.phone, "scrape", _labeled(best)),
        )
        if merged:
            enriched.best_contact_phone = merged


def _apply_website(enriched: EnrichedLead, result: LeadInvestigationResult) -> None:
    if result.website_url:
        if verify_website_url(result.website_url):
            enriched.website = result.website_url
        else:
            logger.info("Rejected unverified website_url: %s", result.website_url)
    elif not enriched.website:
        picked = pick_verified_website_url(result.source_urls, enriched.business_name)
        if picked:
            enriched.website = picked
    if result.contact_form_url and not enriched.website:
        form_base = result.contact_form_url.split("#")[0]
        if verify_website_url(form_base):
            enriched.website = form_base


def _merge_best_phone(
    enriched: EnrichedLead,
    scrape_phone: str | None,
    *,
    labeled: bool,
) -> None:
    if not scrape_phone or is_placeholder_phone(scrape_phone):
        return
    merged = pick_best_phone(
        enriched.main_phone,
        (scrape_phone, "scrape", labeled),
    )
    if not merged:
        return
    enriched.best_contact_phone = merged
    if not enriched.main_phone or not is_callable_phone(enriched.main_phone):
        enriched.main_phone = merged


def apply_investigation(
    enriched: EnrichedLead,
    result: LeadInvestigationResult,
    *,
    source_tool: str,
) -> EnrichedLead:
    _apply_website(enriched, result)
    _apply_site_contacts(enriched, result)

    if result.contact_name:
        enriched.best_contact_name = result.contact_name
    if result.contact_role:
        enriched.best_contact_role = result.contact_role
    if result.contact_phone:
        labeled = bool(
            (result.contact_role or "").strip()
            or (result.contact_name or "").strip()
        )
        _merge_best_phone(enriched, result.contact_phone, labeled=labeled)
    if result.contact_email:
        enriched.best_contact_email_or_form = result.contact_email
    elif result.contact_form_url:
        enriched.best_contact_email_or_form = f"Contact form ({result.contact_form_url})"
        if not enriched.site_contacts:
            enriched.site_contacts = [
                SiteContact(
                    label="Contact form",
                    email=result.contact_form_url,
                    priority="fallback",
                )
            ]

    if result.property_manager:
        enriched.property_manager_or_ownership_clue = result.property_manager
        if result.source_urls:
            enriched.management_source_url = result.source_urls[0]

    if result.exterior_signals:
        enriched.exterior_cleaning_need_signals = result.exterior_signals
    if result.pitch_angle:
        enriched.why_this_is_a_good_fit = result.pitch_angle
    if result.sales_talking_points:
        enriched.sales_talking_points = result.sales_talking_points
    if result.contact_form_url:
        enriched.contact_source_url = result.contact_form_url
    elif result.source_urls:
        enriched.evidence_urls = result.source_urls
        enriched.contact_source_url = result.source_urls[0]

    if enriched.notes.startswith("No website") and enriched.website:
        enriched.notes = "Website found via Firecrawl (not on Google listing)"

    if enriched.best_contact_phone in ("", NOT_FOUND) and is_callable_phone(enriched.main_phone):
        enriched.best_contact_phone = normalize_phone(enriched.main_phone) or enriched.main_phone

    enriched.source_tool = source_tool
    enriched.investigation_status = InvestigationStatus.ENRICHED
    return enriched


def apply_baseline_fields(enriched: EnrichedLead, raw: RawLead) -> EnrichedLead:
    if raw.main_phone and is_callable_phone(raw.main_phone):
        merged = pick_best_phone(
            raw.main_phone,
            (enriched.best_contact_phone, "scrape", enriched.best_contact_role not in ("", NOT_FOUND)),
        )
        if merged:
            enriched.best_contact_phone = merged
            enriched.best_contact_type = "google places phone"
            enriched.contact_source_url = raw.google_maps_url or NOT_FOUND
            if not enriched.site_contacts:
                normalized = normalize_phone(raw.main_phone) or raw.main_phone
                enriched.site_contacts = [
                    SiteContact(label="Main line (Google)", phone=normalized, priority="fallback")
                ]

    return enriched

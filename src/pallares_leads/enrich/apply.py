from __future__ import annotations

import logging

from pallares_leads.enrich.contact_requirements import (
    is_callable_phone,
    is_decision_maker_role,
    is_local_callable_phone,
)
from pallares_leads.enrich.domain_verify import pick_verified_website_url, verify_website_url
from pallares_leads.enrich.schema import LeadInvestigationResult
from pallares_leads.enrich.verify import is_placeholder_name
from pallares_leads.schemas import (
    NOT_FOUND,
    EnrichedLead,
    InvestigationStatus,
    RawLead,
    SiteContact,
)
from pallares_leads.utils.normalize import normalize_phone, phone_digits

logger = logging.getLogger(__name__)

GOOGLE_MAIN_LINE_LABEL = "Main line (Google)"

# Contacts whose verification passed the grounding gate (or came from an API/registry).
_TRUSTED_VERIFICATIONS = ("verified", "corroborated", "unverified")


def _valid_site_contacts(contacts: list[SiteContact]) -> list[SiteContact]:
    cleaned: list[SiteContact] = []
    for contact in contacts:
        if contact.phone and not is_callable_phone(contact.phone):
            logger.info("Rejected invalid site contact phone: %s", contact.phone)
            contact = contact.model_copy(update={"phone": ""})
        cleaned.append(contact)
    return cleaned


def _contact_key(contact: SiteContact) -> tuple[str, str, str]:
    return (
        contact.name.strip().casefold(),
        contact.phone.strip(),
        contact.email.strip().casefold(),
    )


def _merge_site_contacts(
    existing: list[SiteContact],
    incoming: list[SiteContact],
) -> list[SiteContact]:
    """Union of contacts, deduped by (name, phone, email). Contacts stay atomic."""
    merged: list[SiteContact] = []
    seen: set[tuple[str, str, str]] = set()
    for contact in [*existing, *incoming]:
        key = _contact_key(contact)
        if key == ("", "", ""):
            continue
        if key in seen:
            continue
        seen.add(key)
        merged.append(contact)
    return merged


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


def apply_investigation(
    enriched: EnrichedLead,
    result: LeadInvestigationResult,
    *,
    source_tool: str,
) -> EnrichedLead:
    """Fold a grounded investigation into the lead. Contacts are atomic — a scraped
    contact's name/phone/email always travel together and are never blended with
    other sources. best_contact_* is derived later by derive_best_contact_fields().
    """
    _apply_website(enriched, result)

    incoming = _valid_site_contacts(result.site_contacts)
    source = result.source_urls[0] if result.source_urls else ""
    if (result.contact_name or result.contact_phone or result.contact_email) and not any(
        _contact_key(c)
        == (
            result.contact_name.strip().casefold(),
            result.contact_phone.strip(),
            result.contact_email.strip().casefold(),
        )
        for c in incoming
    ):
        legacy = SiteContact(
            label=result.contact_role,
            name=result.contact_name,
            phone=result.contact_phone if is_callable_phone(result.contact_phone) else "",
            email=result.contact_email,
            priority="good",
            source_url=source,
            verification="unverified",
        )
        if legacy.name or legacy.phone or legacy.email:
            incoming.append(legacy)

    enriched.site_contacts = _merge_site_contacts(enriched.site_contacts, incoming)

    if result.contact_form_url:
        enriched.best_contact_email_or_form = f"Contact form ({result.contact_form_url})"
        enriched.contact_source_url = result.contact_form_url

    if result.property_manager:
        enriched.property_manager_or_ownership_clue = result.property_manager
        if result.source_urls:
            enriched.management_source_url = result.source_urls[0]

    if result.exterior_signals:
        enriched.exterior_cleaning_need_signals = result.exterior_signals
    if result.source_urls:
        merged_evidence = list(dict.fromkeys([*enriched.evidence_urls, *result.source_urls]))
        enriched.evidence_urls = merged_evidence

    if enriched.notes.startswith("No website") and enriched.website:
        enriched.notes = "Website found via Firecrawl (not on Google listing)"

    enriched.source_tool = source_tool
    enriched.investigation_status = InvestigationStatus.ENRICHED
    return enriched


def apply_baseline_fields(enriched: EnrichedLead, raw: RawLead) -> EnrichedLead:
    """Record the Google Places main line as its own verified contact fact.

    Never blends the Google phone into a scraped person — it is a separate,
    honestly-labeled contact.
    """
    if raw.main_phone and is_callable_phone(raw.main_phone):
        normalized = normalize_phone(raw.main_phone) or raw.main_phone
        already = any(
            c.phone == normalized and c.label == GOOGLE_MAIN_LINE_LABEL
            for c in enriched.site_contacts
        )
        if not already:
            enriched.site_contacts = _merge_site_contacts(
                enriched.site_contacts,
                [
                    SiteContact(
                        label=GOOGLE_MAIN_LINE_LABEL,
                        phone=normalized,
                        priority="fallback",
                        source_url=raw.google_maps_url or "",
                        verification="verified",
                        quote="Listed as the business phone on the Google Places listing",
                    )
                ],
            )
    return derive_best_contact_fields(enriched)


_ROLE_PRIORITY: tuple[tuple[str, ...], ...] = (
    ("facilities manager", "facilities"),
    ("maintenance manager", "maintenance supervisor", "maintenance"),
    ("property manager", "property management"),
    ("owner", "landlord", "principal"),
    ("general manager", "gm"),
    ("leasing", "leasing manager"),
)


def _role_priority_rank(label: str, name: str) -> int:
    text = f"{label} {name}".casefold()
    for rank, keywords in enumerate(_ROLE_PRIORITY):
        if any(kw in text for kw in keywords):
            return rank
    return len(_ROLE_PRIORITY)


def _is_atomic_dm_contact(contact: SiteContact) -> bool:
    return bool(
        contact.name.strip()
        and not is_placeholder_name(contact.name)
        and is_decision_maker_role(contact.label)
        and is_local_callable_phone(contact.phone)
    )


def _rank_best_contact(contact: SiteContact) -> tuple[int, int, int, int, int]:
    """Lower is better: atomic DM first, then verification, role, named+labeled."""
    atomic_rank = 0 if _is_atomic_dm_contact(contact) else 1
    verification_rank = {
        "verified": 0,
        "corroborated": 1,
        "unverified": 2,
    }.get(contact.verification, 3)
    role_rank = _role_priority_rank(contact.label, contact.name)
    has_name = 0 if contact.name.strip() else 1
    has_label = 0 if contact.label.strip() else 1
    return (
        atomic_rank,
        verification_rank,
        role_rank,
        has_name + has_label,
        0 if contact.phone else 1,
    )


def _contact_has_derive_phone(contact: SiteContact) -> bool:
    phone = contact.phone.strip()
    if not phone:
        return False
    if is_callable_phone(phone):
        return True
    if contact.verification == "corroborated":
        digits = phone_digits(phone)
        return len(digits) == 10
    return False


def _apply_best_from_contact(enriched: EnrichedLead, best: SiteContact) -> EnrichedLead:
    is_google_line = best.label == GOOGLE_MAIN_LINE_LABEL
    role_rank = _role_priority_rank(best.label, best.name)
    matched_role = (
        _ROLE_PRIORITY[role_rank][0]
        if role_rank < len(_ROLE_PRIORITY)
        else (best.label or "site contact")
    )
    enriched.best_contact_type = (
        "google places phone" if is_google_line else matched_role
    )
    enriched.best_contact_name = best.name or NOT_FOUND
    enriched.best_contact_role = (
        "Main line — ask for owner/GM"
        if is_google_line and not best.name
        else (best.label or NOT_FOUND)
    )
    enriched.best_contact_phone = (
        normalize_phone(best.phone) or best.phone.strip()
        if best.phone.strip()
        else NOT_FOUND
    )
    if best.email and "@" in best.email:
        enriched.best_contact_email_or_form = best.email
    if best.source_url:
        enriched.contact_source_url = best.source_url
    return enriched


def derive_best_contact_fields(enriched: EnrichedLead) -> EnrichedLead:
    """Derive best_contact_* atomically from one site contact — no cross-source blending.

    Atomic named DMs always win so Ready leads stamp best_contact_phone for Partner
    primary_phone (never empty while a DM site_contact has the phone).
    """
    trusted_contacts = [
        c
        for c in enriched.site_contacts
        if c.verification in _TRUSTED_VERIFICATIONS or not c.verification
    ]
    atomic_dms = [c for c in trusted_contacts if _is_atomic_dm_contact(c)]
    if atomic_dms:
        return _apply_best_from_contact(
            enriched, min(atomic_dms, key=_rank_best_contact)
        )

    callable_contacts = [
        c
        for c in trusted_contacts
        if _contact_has_derive_phone(c) or (c.email and "@" in c.email)
    ]
    if callable_contacts:
        return _apply_best_from_contact(
            enriched, min(callable_contacts, key=_rank_best_contact)
        )

    named_contacts = [c for c in trusted_contacts if c.name.strip()]
    if named_contacts:
        named_best = min(named_contacts, key=_rank_best_contact)
        enriched.best_contact_type = (
            _ROLE_PRIORITY[_role_priority_rank(named_best.label, named_best.name)][0]
            if _role_priority_rank(named_best.label, named_best.name) < len(_ROLE_PRIORITY)
            else (named_best.label or "site contact")
        )
        enriched.best_contact_name = named_best.name
        enriched.best_contact_role = named_best.label or NOT_FOUND
        if named_best.source_url:
            enriched.contact_source_url = named_best.source_url
        return enriched

    if is_callable_phone(enriched.main_phone):
        normalized = normalize_phone(enriched.main_phone) or enriched.main_phone
        enriched.best_contact_type = "google places phone"
        enriched.best_contact_name = NOT_FOUND
        enriched.best_contact_role = "Main line — ask for owner/GM"
        enriched.best_contact_phone = normalized
        enriched.contact_source_url = enriched.google_maps_url or NOT_FOUND
    return enriched

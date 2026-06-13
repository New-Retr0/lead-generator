from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

from pallares_leads.config_loader import JurisdictionRegistry, load_jurisdictions, load_markets
from pallares_leads.enrich.browser_use_client import (
    BrowserUseClient,
    LoopNetResult,
    SosEntityResult,
)
from pallares_leads.enrich.contact_requirements import EnrichmentRules, enriched_meets_bar
from pallares_leads.resolve.contact_hierarchy import contact_to_fields, pick_best_contact
from pallares_leads.schemas import NOT_FOUND, EnrichedLead, ExtractedContact, RawLead, SiteContact

if TYPE_CHECKING:
    from pallares_leads.db.store import LeadStore
    from pallares_leads.settings import Settings

logger = logging.getLogger(__name__)

_ENTITY_SUFFIX = re.compile(
    r"\b(llc|l\.l\.c\.|inc|corp|corporation|lp|l\.p\.|trust|holdings|partners)\b",
    re.I,
)


@dataclass(frozen=True)
class OwnerChainResult:
    enriched: EnrichedLead
    ran: bool
    reason: str
    contact_improved: bool = False
    loopnet_used: bool = False


def _looks_like_entity(name: str) -> bool:
    return bool(_ENTITY_SUFFIX.search(name))


def _bbb_alternate_entity(enriched: EnrichedLead) -> str:
    for fact in enriched.facts:
        if fact.fact_kind != "alternate_name" or fact.source_kind != "bbb":
            continue
        name = fact.value.get("name", "").strip()
        if name and _looks_like_entity(name):
            return name
    return ""


def _seed_entity_name(
    raw: RawLead,
    enriched: EnrichedLead,
    *,
    entity_seed: str = "",
) -> str:
    if entity_seed.strip() and _looks_like_entity(entity_seed):
        return entity_seed.strip()
    bbb = _bbb_alternate_entity(enriched)
    if bbb:
        return bbb
    clue = enriched.property_manager_or_ownership_clue
    if clue not in ("", NOT_FOUND) and _looks_like_entity(clue):
        return clue
    if _looks_like_entity(raw.business_name):
        return raw.business_name
    return ""


def _seed_party_name(raw: RawLead, enriched: EnrichedLead) -> str:
    clue = enriched.property_manager_or_ownership_clue
    if clue not in ("", NOT_FOUND):
        return clue
    return raw.business_name


def _sos_to_contacts(result: SosEntityResult, source: str) -> list[ExtractedContact]:
    contacts: list[ExtractedContact] = []
    if result.registered_agent.strip():
        contacts.append(
            ExtractedContact(
                contact_type="registered_agent",
                name=result.registered_agent.strip(),
                role="Registered Agent",
                source_url=source,
            )
        )
    for officer in result.officers:
        if not officer.name.strip():
            continue
        contacts.append(
            ExtractedContact(
                contact_type="property_owner",
                name=officer.name.strip(),
                role=officer.title.strip() or "Principal",
                source_url=source,
            )
        )
    if result.entity_name.strip() and not contacts:
        contacts.append(
            ExtractedContact(
                contact_type="property_owner",
                name=result.entity_name.strip(),
                role="Entity",
                source_url=source,
            )
        )
    return contacts


def _loopnet_to_contacts(result: LoopNetResult) -> list[ExtractedContact]:
    contacts: list[ExtractedContact] = []
    for broker in result.listed_by:
        if not broker.name.strip() and not broker.phone.strip():
            continue
        contacts.append(
            ExtractedContact(
                contact_type="cre_broker",
                name=broker.name.strip(),
                role=broker.company.strip() or "CRE Broker",
                phone=broker.phone.strip() or None,
                source_url=result.listing_url or None,
            )
        )
    return contacts


def _apply_contacts(enriched: EnrichedLead, contacts: list[ExtractedContact]) -> EnrichedLead:
    if not contacts:
        return enriched
    site_contacts = list(enriched.site_contacts)
    for contact in contacts:
        site_contacts.append(
            SiteContact(
                label=contact.contact_type.replace("_", " "),
                name=contact.name or "",
                phone=contact.phone or "",
                email=contact.email_or_form or "",
                priority="good",
            )
        )
    enriched.site_contacts = site_contacts
    best = pick_best_contact(contacts, property_type=enriched.property_type)
    for key, value in contact_to_fields(best).items():
        setattr(enriched, key, value)
    return enriched


def resolve_owner_chain(
    raw: RawLead,
    enriched: EnrichedLead,
    rules: EnrichmentRules,
    *,
    settings: Settings,
    store: LeadStore | None = None,
    browser: BrowserUseClient | None = None,
    jurisdictions: JurisdictionRegistry | None = None,
    owner_chain_count: int = 0,
    loopnet_count: int = 0,
    entity_seed: str = "",
) -> OwnerChainResult:
    """Escalate to county/state portals when Firecrawl tiers did not meet the contact bar."""
    if not rules.allow_owner_chain:
        return OwnerChainResult(
            enriched=enriched, ran=False, reason="category disallows owner chain"
        )

    bbb_entity = entity_seed.strip() or _bbb_alternate_entity(enriched)
    met, detail = enriched_meets_bar(enriched, rules)
    if met and not bbb_entity:
        return OwnerChainResult(
            enriched=enriched, ran=False, reason=f"contact bar already met: {detail}"
        )

    if owner_chain_count >= settings.owner_chain_max_per_run:
        return OwnerChainResult(
            enriched=enriched,
            ran=False,
            reason=f"owner_chain_max_per_run ({settings.owner_chain_max_per_run}) reached",
        )

    registry = jurisdictions or load_jurisdictions(settings.config_dir)
    county_cfg = registry.counties.get(_county_key_for_market(raw, settings))
    if county_cfg is None:
        return OwnerChainResult(
            enriched=enriched, ran=False, reason="no county jurisdiction configured"
        )

    client = browser or BrowserUseClient(settings, store=store)
    if not client.is_available():
        return OwnerChainResult(
            enriched=enriched,
            ran=False,
            reason=client.last_skip_reason or "browser use unavailable",
        )

    cached = _reuse_owner_record(raw, enriched, store, rules)
    if cached.contact_improved:
        return cached

    entity_name = _seed_entity_name(raw, enriched, entity_seed=entity_seed or bbb_entity)
    if entity_name and store:
        hit = store.get_owner_record_by_name(entity_name)
        if hit:
            before_met, _ = enriched_meets_bar(enriched, rules)
            enriched = _apply_owner_record(enriched, hit)
            after_met, _ = enriched_meets_bar(enriched, rules)
            return OwnerChainResult(
                enriched=enriched,
                ran=True,
                reason=f"reused owner record for {entity_name}",
                contact_improved=after_met and not before_met,
            )

    state_cfg = registry.state_for_county(county_cfg)
    contacts: list[ExtractedContact] = []
    owner_name = ""
    owner_kind = ""
    apn = ""
    sos_number = ""
    registered_agent = ""
    principals_json: list[dict[str, str]] = []
    mailing_address = ""
    broker_json: list[dict[str, str]] = []
    source = "owner_chain"

    if entity_name and state_cfg:
        sos = client.sos_entity_lookup(entity_name, state_cfg)
        if sos:
            contacts.extend(_sos_to_contacts(sos, state_cfg.sos_business_search.url))
            owner_name = sos.entity_name or entity_name
            owner_kind = "entity"
            sos_number = sos.entity_number
            registered_agent = sos.registered_agent
            mailing_address = sos.principal_address
            principals_json = [o.model_dump() for o in sos.officers]
            source = "owner_chain:sos"

    if not contacts:
        party = _seed_party_name(raw, enriched)
        recorder = client.recorder_party_search(party, county_cfg)
        if recorder and recorder.matches:
            owner_name = recorder.matches[0].party_name or party
            owner_kind = "recorder_party"
            source = "owner_chain:recorder"
            if _looks_like_entity(owner_name) and state_cfg:
                sos = client.sos_entity_lookup(owner_name, state_cfg)
                if sos:
                    contacts.extend(_sos_to_contacts(sos, state_cfg.sos_business_search.url))
                    sos_number = sos.entity_number
                    registered_agent = sos.registered_agent
                    principals_json = [o.model_dump() for o in sos.officers]
                    source = "owner_chain:recorder+sos"

    if (
        not contacts
        and county_cfg.parcel_portal
        and county_cfg.parcel_portal.owner_names_online is not False
    ):
        parcel = client.parcel_owner_lookup(raw.formatted_address, raw.city, county_cfg)
        if parcel and parcel.owner_name.strip():
            owner_name = parcel.owner_name
            owner_kind = parcel.owner_kind or "parcel_owner"
            apn = parcel.apn
            mailing_address = parcel.mailing_address
            contacts.append(
                ExtractedContact(
                    contact_type="property_owner",
                    name=parcel.owner_name.strip(),
                    role="Parcel Owner",
                )
            )
            source = "owner_chain:parcel"
            if _looks_like_entity(owner_name) and state_cfg:
                sos = client.sos_entity_lookup(owner_name, state_cfg)
                if sos:
                    contacts.extend(_sos_to_contacts(sos, state_cfg.sos_business_search.url))
                    sos_number = sos.entity_number
                    registered_agent = sos.registered_agent
                    principals_json = [o.model_dump() for o in sos.officers]
                    source = "owner_chain:parcel+sos"

    loopnet_used = False
    leasing_clue = enriched.property_manager_or_ownership_clue not in ("", NOT_FOUND)
    needs_loopnet = leasing_clue or raw.property_type in {
        "parking",
        "strip_mall",
        "shopping_center",
    }
    if not contacts and needs_loopnet and loopnet_count < settings.loopnet_max_per_run:
        loopnet = client.loopnet_listing_lookup(raw.business_name, raw.city)
        if loopnet:
            contacts.extend(_loopnet_to_contacts(loopnet))
            broker_json = [b.model_dump() for b in loopnet.listed_by]
            source = "owner_chain:loopnet"
            loopnet_used = True

    if not contacts:
        return OwnerChainResult(
            enriched=enriched,
            ran=True,
            reason="owner chain ran but no portal contacts found",
        )

    before_met, _ = enriched_meets_bar(enriched, rules)
    enriched = _apply_contacts(enriched, contacts)
    if owner_name:
        enriched.property_manager_or_ownership_clue = owner_name
    enriched.source_tool = f"{enriched.source_tool}+owner_chain"
    enriched.notes = (enriched.notes + f"; owner chain: {source}").strip("; ").strip()
    after_met, _ = enriched_meets_bar(enriched, rules)

    if store:
        store.upsert_owner_record(
            place_id=raw.place_id,
            apn=apn,
            owner_name=owner_name or entity_name or raw.business_name,
            owner_kind=owner_kind,
            sos_entity_number=sos_number,
            registered_agent=registered_agent,
            principals_json=principals_json,
            mailing_address=mailing_address,
            broker_json=broker_json,
            source=source,
        )

    return OwnerChainResult(
        enriched=enriched,
        ran=True,
        reason=source,
        contact_improved=after_met and not before_met,
        loopnet_used=loopnet_used,
    )


def _county_key_for_market(raw: RawLead, settings: Settings) -> str:
    markets = load_markets(settings.config_dir)
    market = markets.get(raw.market_key or "")
    if market:
        county = market.get("county")
        if county:
            return str(county)
    return "fresno_ca"


def _reuse_owner_record(
    raw: RawLead,
    enriched: EnrichedLead,
    store: LeadStore | None,
    rules: EnrichmentRules,
) -> OwnerChainResult:
    if store is None:
        return OwnerChainResult(enriched=enriched, ran=False, reason="")
    record = store.get_owner_record(raw.place_id)
    if record is None:
        return OwnerChainResult(enriched=enriched, ran=False, reason="")
    enriched = _apply_owner_record(enriched, record)
    met, detail = enriched_meets_bar(enriched, rules)
    if met:
        return OwnerChainResult(
            enriched=enriched,
            ran=True,
            reason=f"reused owner record for place: {detail}",
            contact_improved=True,
        )
    return OwnerChainResult(enriched=enriched, ran=False, reason="")


def _apply_owner_record(enriched: EnrichedLead, record: dict) -> EnrichedLead:
    contacts: list[ExtractedContact] = []
    if record.get("registered_agent"):
        contacts.append(
            ExtractedContact(
                contact_type="registered_agent",
                name=str(record["registered_agent"]),
                role="Registered Agent",
            )
        )
    for principal in record.get("principals_json") or []:
        if isinstance(principal, dict) and principal.get("name"):
            contacts.append(
                ExtractedContact(
                    contact_type="property_owner",
                    name=str(principal["name"]),
                    role=str(principal.get("title") or "Principal"),
                )
            )
    for broker in record.get("broker_json") or []:
        if isinstance(broker, dict) and (broker.get("name") or broker.get("phone")):
            contacts.append(
                ExtractedContact(
                    contact_type="cre_broker",
                    name=str(broker.get("name") or ""),
                    role=str(broker.get("company") or "CRE Broker"),
                    phone=str(broker.get("phone") or "") or None,
                )
            )
    if record.get("owner_name"):
        enriched.property_manager_or_ownership_clue = str(record["owner_name"])
    return _apply_contacts(enriched, contacts)

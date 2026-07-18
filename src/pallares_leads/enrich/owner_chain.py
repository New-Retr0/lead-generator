from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

from pallares_leads.config_loader import JurisdictionRegistry, load_jurisdictions, load_markets
from pallares_leads.enrich.apply import derive_best_contact_fields
from pallares_leads.enrich.contact_requirements import EnrichmentRules, enriched_meets_bar
from pallares_leads.enrich.firecrawl_client import FirecrawlClient
from pallares_leads.progress import emit as progress_emit
from pallares_leads.schemas import NOT_FOUND, EnrichedLead, ExtractedContact, RawLead, SiteContact
from pallares_leads.settings import Settings

if TYPE_CHECKING:
    from pallares_leads.db.store import LeadStore

logger = logging.getLogger(__name__)

_ENTITY_SUFFIX = re.compile(
    r"\b(llc|l\.l\.c\.|inc|corp|corporation|lp|l\.p\.|trust|holdings|partners)\b",
    re.I,
)

_STATE_DISPLAY_NAMES: dict[str, str] = {
    "ca": "California",
    "hi": "Hawaii",
    "or": "Oregon",
    "wa": "Washington",
    "nm": "New Mexico",
    "nv": "Nevada",
    "az": "Arizona",
}


@dataclass(frozen=True)
class OwnerChainResult:
    enriched: EnrichedLead
    ran: bool
    reason: str
    contact_improved: bool = False
    # Historical field: dedicated LoopNet/Browser Use lookups are gone; brokers may
    # still arrive via the Firecrawl agent payload (see _agent_data_to_contacts).
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
                # SOS / recorder / agent officers are source-backed public records.
                verification="verified",
                source_url=contact.source_url or "",
            )
        )
    enriched.site_contacts = site_contacts
    return derive_best_contact_fields(enriched)


def _resolve_via_firecrawl_agent(
    raw: RawLead,
    enriched: EnrichedLead,
    rules: EnrichmentRules,
    *,
    settings: Settings,
    store: LeadStore | None,
    registry: JurisdictionRegistry,
    county_cfg,
    entity_seed: str,
    firecrawl: FirecrawlClient | None = None,
) -> OwnerChainResult:
    """Owner-chain via Firecrawl /v2/agent (SOS, recorder, parcel portals)."""
    if not settings.firecrawl_api_key:
        return OwnerChainResult(enriched=enriched, ran=False, reason="firecrawl agent: no API key")

    state_cfg = registry.state_for_county(county_cfg)
    if state_cfg is None:
        return OwnerChainResult(
            enriched=enriched, ran=False, reason="firecrawl agent: no state jurisdiction"
        )

    entity_name = _seed_entity_name(raw, enriched, entity_seed=entity_seed)
    fc = firecrawl or FirecrawlClient(settings, store=store)
    fc.set_cost_context(place_id=raw.place_id)

    state_name = _STATE_DISPLAY_NAMES.get(county_cfg.state.lower(), county_cfg.state.upper())
    data = fc.run_owner_chain_agent(
        entity_name=entity_name,
        party_name=_seed_party_name(raw, enriched),
        address=raw.formatted_address,
        city=raw.city,
        state_name=state_name,
        sos_url=state_cfg.sos_business_search.url,
        recorder_url=county_cfg.recorder.url if county_cfg.recorder else None,
        parcel_url=county_cfg.parcel_portal.url if county_cfg.parcel_portal else None,
    )
    if not data:
        return OwnerChainResult(
            enriched=enriched,
            ran=True,
            reason="firecrawl agent returned no contacts",
        )

    source = "owner_chain:firecrawl_agent"
    contacts = _agent_data_to_contacts(data, state_cfg.sos_business_search.url or source)
    if not contacts:
        return OwnerChainResult(
            enriched=enriched,
            ran=True,
            reason="firecrawl agent returned no contacts",
        )

    before_met, _ = enriched_meets_bar(enriched, rules)
    enriched = _apply_contacts(enriched, contacts)
    owner_name = str(data.get("owner_name") or data.get("entity_name") or entity_name).strip()
    if owner_name:
        enriched.property_manager_or_ownership_clue = owner_name
    enriched.source_tool = f"{enriched.source_tool}+owner_chain:firecrawl_agent"
    after_met, _ = enriched_meets_bar(enriched, rules)

    if store:
        principals_json = [
            {"name": str(o.get("name") or ""), "title": str(o.get("title") or "")}
            for o in (data.get("officers") or [])
            if isinstance(o, dict) and o.get("name")
        ]
        store.upsert_owner_record(
            place_id=raw.place_id,
            owner_name=owner_name or entity_name or raw.business_name,
            owner_kind="entity" if _looks_like_entity(owner_name) else "agent_lookup",
            sos_entity_number=str(data.get("entity_number") or ""),
            registered_agent=str(data.get("registered_agent") or ""),
            principals_json=principals_json,
            source=source,
        )

    return OwnerChainResult(
        enriched=enriched,
        ran=True,
        reason=source,
        contact_improved=after_met and not before_met,
    )


def _agent_data_to_contacts(data: dict, source: str) -> list[ExtractedContact]:
    contacts: list[ExtractedContact] = []
    registered_agent = str(data.get("registered_agent") or "").strip()
    if registered_agent:
        contacts.append(
            ExtractedContact(
                contact_type="registered_agent",
                name=registered_agent,
                role="Registered Agent",
                source_url=source,
            )
        )
    for officer in data.get("officers") or []:
        if not isinstance(officer, dict):
            continue
        name = str(officer.get("name") or "").strip()
        if not name:
            continue
        contacts.append(
            ExtractedContact(
                contact_type="property_owner",
                name=name,
                role=str(officer.get("title") or "Principal").strip() or "Principal",
                source_url=source,
            )
        )
    owner_name = str(data.get("owner_name") or data.get("entity_name") or "").strip()
    if owner_name and not any(c.name == owner_name for c in contacts):
        contacts.append(
            ExtractedContact(
                contact_type="property_owner",
                name=owner_name,
                role="Owner",
                source_url=source,
            )
        )
    broker_name = str(data.get("broker_name") or "").strip()
    broker_phone = str(data.get("broker_phone") or "").strip()
    if broker_name or broker_phone:
        contacts.append(
            ExtractedContact(
                contact_type="cre_broker",
                name=broker_name,
                role=str(data.get("broker_company") or "CRE Broker").strip() or "CRE Broker",
                phone=broker_phone or None,
                source_url=source,
            )
        )
    return contacts


def _emit_owner_chain_backend(
    *,
    backend: str,
    reason: str,
    place_id: str,
    run_id: str | None,
    available: bool,
) -> None:
    logger.info(
        "owner_chain backend selected: backend=%s available=%s reason=%s place_id=%s",
        backend,
        available,
        reason,
        place_id,
    )
    progress_emit(
        "owner_chain_backend",
        place_id=place_id,
        run_id=run_id,
        backend=backend,
        available=available,
        reason=reason,
    )


def resolve_owner_chain(
    raw: RawLead,
    enriched: EnrichedLead,
    rules: EnrichmentRules,
    *,
    settings: Settings,
    store: LeadStore | None = None,
    firecrawl: FirecrawlClient | None = None,
    jurisdictions: JurisdictionRegistry | None = None,
    owner_chain_count: int = 0,
    entity_seed: str = "",
    run_id: str | None = None,
) -> OwnerChainResult:
    """Escalate to county/state portals via Firecrawl agent when tiers miss the contact bar."""
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

    available = bool(settings.firecrawl_api_key)
    _emit_owner_chain_backend(
        backend="firecrawl_agent",
        reason="owner chain uses Firecrawl agent only",
        place_id=raw.place_id,
        run_id=run_id,
        available=available,
    )
    if not available:
        return OwnerChainResult(
            enriched=enriched,
            ran=False,
            reason="FIRECRAWL_API_KEY required for owner-chain Firecrawl agent",
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
            enriched.source_tool = f"{enriched.source_tool}+owner_chain"
            after_met, _ = enriched_meets_bar(enriched, rules)
            if store:
                store.upsert_owner_record(
                    place_id=raw.place_id,
                    apn=str(hit.get("apn") or ""),
                    owner_name=str(hit.get("owner_name") or entity_name),
                    owner_kind=str(hit.get("owner_kind") or ""),
                    sos_entity_number=str(hit.get("sos_entity_number") or ""),
                    registered_agent=str(hit.get("registered_agent") or ""),
                    principals_json=hit.get("principals_json") or [],
                    mailing_address=str(hit.get("mailing_address") or ""),
                    broker_json=hit.get("broker_json") or [],
                    source=str(hit.get("source") or "owner_chain:reuse"),
                )
            return OwnerChainResult(
                enriched=enriched,
                ran=True,
                reason=f"reused owner record for {entity_name}",
                contact_improved=after_met and not before_met,
            )

    return _resolve_via_firecrawl_agent(
        raw,
        enriched,
        rules,
        settings=settings,
        store=store,
        registry=registry,
        county_cfg=county_cfg,
        entity_seed=bbb_entity,
        firecrawl=firecrawl,
    )


def _county_key_for_market(raw: RawLead, settings: Settings) -> str | None:
    markets = load_markets(settings.config_dir)
    market = markets.get(raw.market_key or "")
    if market:
        county = market.get("county")
        if county:
            return str(county)
    return None


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
    trial = _apply_owner_record(enriched.model_copy(deep=True), record)
    met, detail = enriched_meets_bar(trial, rules)
    if met:
        return OwnerChainResult(
            enriched=trial,
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

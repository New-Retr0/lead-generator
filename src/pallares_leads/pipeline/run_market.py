from __future__ import annotations

import json
import logging
import re
import threading
import time
from concurrent.futures import (
    FIRST_COMPLETED,
    ThreadPoolExecutor,
    wait,
)
from concurrent.futures import (
    TimeoutError as FuturesTimeoutError,
)
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING

from pallares_leads.config_loader import CategoryConfig, MarketConfig, load_markets
from pallares_leads.db.store import LeadStore
from pallares_leads.discover.county_filter import filter_excluded_counties
from pallares_leads.discover.places import PlacesClient
from pallares_leads.enrich.apply import (
    _ROLE_PRIORITY,
    _role_priority_rank,
    apply_baseline_fields,
    apply_investigation,
    derive_best_contact_fields,
)
from pallares_leads.enrich.contact_extract import (
    exterior_signals,
    merge_page_contacts,
    property_manager_clues,
)
from pallares_leads.enrich.contact_requirements import (
    EnrichmentRules,
    contact_package_complete,
    contact_package_gaps,
    enriched_meets_bar,
    get_enrichment_rules,
    has_atomic_named_decision_maker,
    has_verified_named_decision_maker,
    investigation_meets_bar,
    is_callable_phone,
    needs_package_enrichment,
    requires_named_decision_maker,
    tier2_gap_reason,
)
from pallares_leads.enrich.domain_verify import scrub_unverified_website
from pallares_leads.enrich.firecrawl_client import FirecrawlClient
from pallares_leads.enrich.gap_fill import (
    finalize_enrichment_notes,
    merge_firecrawl_into_lead,
    resolve_website,
)
from pallares_leads.enrich.google_gaps import GoogleGaps, gap_summary
from pallares_leads.enrich.insurance import insurance_facts_from_pages
from pallares_leads.enrich.lead_profile import (
    MULTI_TENANT_PROPERTY_TYPES,
    EnrichmentPlaybook,
    LeadProfile,
    classify_lead,
    learn_management_playbook,
    learn_playbook_from_outcome,
    management_profile_key,
    merge_playbooks,
    should_use_profile_fast_path,
    static_playbook_for,
)
from pallares_leads.enrich.linkedin_serp import (
    build_linkedin_query,
    linkedin_serp_facts,
    linkedin_serp_site_contacts,
    parse_linkedin_serp_results,
)
from pallares_leads.enrich.owner_chain import resolve_owner_chain
from pallares_leads.enrich.registries.bbb import (
    bbb_contacts,
    bbb_profile_to_facts,
    find_bbb_profile_url,
    parse_bbb_profile,
)
from pallares_leads.enrich.registries.license_lookup import (
    find_license_record_url,
    license_contacts,
    license_record_to_facts,
    lookup_config_for_lead,
    parse_license_record,
    should_run_license_lookup,
)
from pallares_leads.enrich.schema import LeadInvestigationResult
from pallares_leads.enrich.socials import social_facts_from_pages
from pallares_leads.enrich.source_checklist import run_source_checklist
from pallares_leads.enrich.verify import Rejection
from pallares_leads.intelligence.features import FEATURE_VERSION, build_feature_snapshot
from pallares_leads.pipeline.dedupe import dedupe_leads
from pallares_leads.pipeline.export_csv import export_csv
from pallares_leads.progress import bind_progress
from pallares_leads.progress import emit as progress_emit
from pallares_leads.resolve.dud_gate import discovery_dud_reason, terminal_dud_reason
from pallares_leads.resolve.lead_score import compute_lead_score
from pallares_leads.resolve.verification import (
    compute_verification_level,
    verification_to_confidence,
)
from pallares_leads.schemas import (
    NOT_FOUND,
    Confidence,
    EnrichedLead,
    ExtractedContact,
    InvestigationStatus,
    LeadFact,
    RawLead,
    SiteContact,
)
from pallares_leads.settings import Settings
from pallares_leads.utils.errors import failure_fields
from pallares_leads.utils.http_retry import OutOfCreditsError
from pallares_leads.utils.normalize import slugify
from pallares_leads.utils.snapshots import append_jsonl

if TYPE_CHECKING:
    from pallares_leads.eval.trace import LeadEvalTrace

logger = logging.getLogger(__name__)


def _discover_category(
    *,
    settings: Settings,
    market_key: str,
    market: MarketConfig,
    category: CategoryConfig,
    limit: int | None = None,
    store: LeadStore | None = None,
    run_id: str | None = None,
) -> list[RawLead]:
    places = PlacesClient(settings, store=store, run_id=run_id)
    return places.discover_category(
        market_key=market_key,
        market=market,
        category=category,
        limit=limit,
    )


def _apply_verification_fields(enriched: EnrichedLead) -> EnrichedLead:
    enriched = derive_best_contact_fields(enriched)
    enriched.verification_level = compute_verification_level(enriched)
    enriched.confidence = Confidence(verification_to_confidence(enriched.verification_level))
    return enriched


def _apply_lead_score(enriched: EnrichedLead) -> EnrichedLead:
    enriched.lead_score = compute_lead_score(enriched)
    return enriched


def _run_artifacts_dir(settings: Settings, run_id: str) -> Path:
    path = settings.runs_dir / run_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def _write_run_manifest(
    settings: Settings,
    store: LeadStore,
    *,
    run_id: str,
    market_key: str,
    category_key: str,
    raw_path: Path | None,
    export_path: Path | None,
    discovered_count: int,
    skipped_known_count: int,
    enriched_count: int,
) -> None:
    run_dir = _run_artifacts_dir(settings, run_id)
    report = store.run_report(run_id)
    cost = report.get("cost_summary") or {}
    manifest = {
        "run_id": run_id,
        "market_key": market_key,
        "category_key": category_key,
        "discovered_count": discovered_count,
        "skipped_known_count": skipped_known_count,
        "enriched_count": enriched_count,
        "credits_est_total": report.get("credits_est_total", 0),
        "cost_summary": cost,
        "files": {
            "raw_jsonl": str(raw_path) if raw_path else None,
            "export_csv": str(export_path) if export_path else None,
        },
    }
    (run_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def _snapshot_path(settings: Settings, raw: RawLead, ext: str) -> Path:
    return (
        settings.snapshots_dir
        / slugify(raw.market_key)
        / slugify(raw.property_type)
        / f"{slugify(raw.business_name)}{ext}"
    )


def _has_callable_phone(enriched: EnrichedLead) -> bool:
    if is_callable_phone(enriched.best_contact_phone):
        return True
    if is_callable_phone(enriched.main_phone):
        return True
    return any(is_callable_phone(c.phone) for c in enriched.site_contacts)


def _has_named_person(enriched: EnrichedLead) -> bool:
    return any(c.name.strip() for c in enriched.site_contacts)


@contextmanager
def _enrichment_stage(
    stage: str,
    *,
    raw: RawLead,
    run_id: str | None,
    firecrawl: FirecrawlClient | None,
):
    if firecrawl is not None:
        firecrawl.set_cost_context(stage=stage)
    started = time.perf_counter()
    try:
        yield
    finally:
        progress_emit(
            "stage_done",
            place_id=raw.place_id,
            business=raw.business_name,
            run_id=run_id,
            stage=stage,
            duration_ms=int((time.perf_counter() - started) * 1000),
        )


def _decision_maker_regex_contacts(contacts: list[ExtractedContact]) -> list[ExtractedContact]:
    good: list[ExtractedContact] = []
    for contact in contacts:
        if not contact.name or not contact.name.strip():
            continue
        if not is_callable_phone(contact.phone):
            continue
        rank = _role_priority_rank(contact.role or contact.contact_type, contact.name)
        if rank < len(_ROLE_PRIORITY):
            good.append(contact)
    return good


def _investigation_from_regex_pages(
    pages: list[tuple[str, str]],
    regex_contacts: list[ExtractedContact],
    raw: RawLead,
) -> LeadInvestigationResult:
    combined = "\n".join(md for _, md in pages)
    decision = min(
        _decision_maker_regex_contacts(regex_contacts),
        key=lambda contact: _role_priority_rank(
            contact.role or contact.contact_type,
            contact.name,
        ),
    )
    site_contacts = [
        SiteContact(
            label=contact.contact_type.replace("_", " "),
            name=contact.name or "",
            phone=contact.phone or "",
            email=contact.email_or_form or "",
            priority="good",
            source_url=contact.source_url or "",
            verification="corroborated",
        )
        for contact in regex_contacts
    ]
    source_url = pages[0][0] if pages else ""
    return LeadInvestigationResult(
        site_contacts=site_contacts,
        contact_name=decision.name,
        contact_role=decision.role or decision.contact_type,
        contact_phone=decision.phone or "",
        exterior_signals=exterior_signals(combined, raw.property_type),
        source_urls=[source_url] if source_url else [],
    )


def _scrape_fallback(
    raw: RawLead,
    firecrawl: FirecrawlClient,
    enriched: EnrichedLead,
    settings: Settings,
) -> tuple[EnrichedLead, LeadInvestigationResult | None]:
    """Markdown fallback: regex pre-check, then Firecrawl scrape+JSON + grounding."""
    pages = firecrawl.scrape_site(raw.website or "")
    if not pages:
        return enriched, None

    combined = ""
    evidence: list[str] = []
    for url, md in pages:
        evidence.append(url)
        combined += md + "\n"

    regex_contacts = merge_page_contacts(pages)
    if _decision_maker_regex_contacts(regex_contacts):
        investigation = _investigation_from_regex_pages(pages, regex_contacts, raw)
        source_url = pages[0][0]
        clue = property_manager_clues(combined)
        if clue:
            enriched.property_manager_or_ownership_clue = clue
            enriched.management_source_url = source_url
        if investigation.exterior_signals:
            enriched.exterior_cleaning_need_signals = investigation.exterior_signals
        elif not enriched.exterior_cleaning_need_signals:
            enriched.exterior_cleaning_need_signals = exterior_signals(combined, raw.property_type)
        enriched.evidence_urls = list(dict.fromkeys([*enriched.evidence_urls, *evidence]))
        return enriched, investigation

    if not regex_contacts and not re.search(r"\(\d{3}\)\s*\d{3}-\d{4}", combined):
        return enriched, None

    source_url = pages[0][0]
    result = firecrawl.scrape_lead_json_url(source_url, raw)
    if not result:
        return enriched, None

    clue = property_manager_clues(combined)
    if clue:
        enriched.property_manager_or_ownership_clue = clue
        enriched.management_source_url = source_url

    if result.exterior_signals:
        enriched.exterior_cleaning_need_signals = result.exterior_signals
    elif not enriched.exterior_cleaning_need_signals:
        enriched.exterior_cleaning_need_signals = exterior_signals(combined, raw.property_type)

    enriched.evidence_urls = list(dict.fromkeys([*enriched.evidence_urls, *evidence]))
    if result.source_urls:
        enriched.evidence_urls = list(dict.fromkeys([*enriched.evidence_urls, *result.source_urls]))
    return enriched, result


def _try_leasing_tier(
    work_raw: RawLead,
    firecrawl: FirecrawlClient,
    enriched: EnrichedLead,
    investigation: LeadInvestigationResult | None,
    tier_rules: EnrichmentRules,
    *,
    trace: LeadEvalTrace | None = None,
) -> tuple[EnrichedLead, LeadInvestigationResult | None, bool]:
    """Map leasing/management URLs and broker PDFs when contact bar is still unmet."""
    if work_raw.property_type not in MULTI_TENANT_PROPERTY_TYPES or not work_raw.website:
        return enriched, investigation, False

    firecrawl.set_cost_context(stage="leasing")
    improved = False
    mapped = firecrawl.map_contact_urls(work_raw.website, limit=10)
    leasing_urls = [
        url
        for url in mapped
        if any(h in url.lower() for h in ("leasing", "management", "contact", "about"))
    ]
    for url in leasing_urls[:3]:
        sub = firecrawl.scrape_lead_json_url(url, work_raw)
        if not sub:
            continue
        if trace:
            trace.record(
                "scrape_json",
                ran=True,
                reason="leasing/management URL gap-fill",
                credits_est=5,
                inputs={"target_url": url},
                outputs=_investigation_outputs(sub),
            )
        enriched = apply_investigation(
            enriched, sub, source_tool="google_places+firecrawl_scrape_json"
        )
        investigation = sub
        if investigation_meets_bar(sub, tier_rules, property_type=work_raw.property_type)[0]:
            improved = True
            break

    return enriched, investigation, improved


def _has_verified_person(enriched: EnrichedLead) -> bool:
    return any(
        c.name.strip() and c.verification in ("verified", "corroborated")
        for c in enriched.site_contacts
    )


def _corroborate_with_bbb(enriched: EnrichedLead, profile) -> int:
    """Upgrade grounded-but-single-source website contacts that BBB independently confirms."""
    upgraded = 0
    bbb_names = {name.casefold() for name, _title in profile.principals}
    bbb_digits = {re.sub(r"\D", "", p) for p in profile.phones}
    updated: list[SiteContact] = []
    for contact in enriched.site_contacts:
        if contact.verification == "unverified":
            name_match = contact.name.strip().casefold() in bbb_names if contact.name else False
            phone_match = re.sub(r"\D", "", contact.phone) in bbb_digits if contact.phone else False
            if name_match or phone_match:
                contact = contact.model_copy(update={"verification": "corroborated"})
                upgraded += 1
        updated.append(contact)
    enriched.site_contacts = updated
    return upgraded


def _try_bbb_tier(
    work_raw: RawLead,
    enriched: EnrichedLead,
    firecrawl: FirecrawlClient,
    tier_rules: EnrichmentRules,
    settings: Settings,
    *,
    trace: LeadEvalTrace | None = None,
) -> EnrichedLead:
    """BBB registry cross-check: deterministic principals, phones, rating, entity names."""
    if "bbb" not in tier_rules.registry_lookups():
        if trace:
            trace.record("bbb", ran=False, reason="registry_lookup disabled for category")
        return enriched
    # Keep running BBB while the outreach package is thin (need email / 2nd DM).
    if contact_package_complete(enriched):
        if trace:
            trace.record("bbb", ran=False, reason="contact package complete")
        return enriched

    firecrawl.set_cost_context(stage="bbb")
    url = find_bbb_profile_url(work_raw, firecrawl.search_web, config_dir=settings.config_dir)
    if not url:
        if trace:
            trace.record("bbb", ran=True, reason="no BBB profile found", credits_est=2)
        logger.info("  BBB: no profile found for %s", work_raw.business_name)
        return enriched

    logger.info("  BBB profile: %s", url)
    markdown = firecrawl.scrape_url(url)
    if not markdown:
        if trace:
            trace.record("bbb", ran=True, reason="BBB profile scrape failed", credits_est=3)
        return enriched

    profile = parse_bbb_profile(markdown, url)
    if not profile.has_data():
        if trace:
            trace.record("bbb", ran=True, reason="BBB profile parsed empty", credits_est=3)
        return enriched

    upgraded = _corroborate_with_bbb(enriched, profile)
    new_contacts = bbb_contacts(profile, page_text=markdown)
    existing_keys = {(c.name.casefold(), c.phone) for c in enriched.site_contacts}
    for contact in new_contacts:
        if (contact.name.casefold(), contact.phone) not in existing_keys:
            enriched.site_contacts = [*enriched.site_contacts, contact]

    enriched.facts = [*enriched.facts, *bbb_profile_to_facts(profile, page_text=markdown)]
    if url not in enriched.evidence_urls:
        enriched.evidence_urls = [*enriched.evidence_urls, url]
    if "bbb" not in (enriched.source_tool or ""):
        enriched.source_tool = f"{enriched.source_tool}+bbb"

    if trace:
        trace.record(
            "bbb",
            ran=True,
            reason=f"BBB profile parsed ({len(profile.principals)} principal(s))",
            credits_est=3,
            inputs={"url": url},
            outputs={
                "rating": profile.rating,
                "principals": [f"{n} — {t}" for n, t in profile.principals],
                "phones": profile.phones,
                "alternate_names": profile.alternate_names,
                "corroborated_contacts": upgraded,
            },
        )
    logger.info(
        "  BBB: %d principal(s), %d phone(s), rating %s",
        len(profile.principals),
        len(profile.phones),
        profile.rating or "n/a",
    )
    return enriched


def _has_pm_clue(enriched: EnrichedLead) -> bool:
    clue = enriched.property_manager_or_ownership_clue or ""
    return clue.strip() not in ("", NOT_FOUND)


def _try_license_tier(
    work_raw: RawLead,
    enriched: EnrichedLead,
    firecrawl: FirecrawlClient,
    tier_rules: EnrichmentRules,
    settings: Settings,
    *,
    trace: LeadEvalTrace | None = None,
) -> EnrichedLead:
    if "state_license" not in tier_rules.registry_lookups():
        if trace:
            trace.record(
                "state_license",
                ran=False,
                reason="state_license not enabled for category",
            )
        return enriched
    if (
        contact_package_complete(enriched)
        and not tier_rules.require_property_manager_clue
    ):
        if trace:
            trace.record("state_license", ran=False, reason="contact package complete")
        return enriched

    firecrawl.set_cost_context(stage="state_license")
    cfg = lookup_config_for_lead(work_raw, config_dir=settings.config_dir)
    should_run, reason = should_run_license_lookup(
        work_raw,
        category_key=work_raw.property_type,
        has_pm_clue=_has_pm_clue(enriched),
        config_dir=settings.config_dir,
    )
    if not should_run:
        if trace:
            trace.record("state_license", ran=False, reason=reason)
        return enriched

    url = find_license_record_url(
        work_raw, cfg, firecrawl.search_web, config_dir=settings.config_dir
    )
    if not url:
        if trace:
            trace.record(
                "state_license",
                ran=True,
                reason="no license record URL found",
                credits_est=2,
            )
        return enriched

    markdown = firecrawl.scrape_url(url) if url != cfg.search_url else ""
    if not markdown and cfg.search_url:
        markdown = firecrawl.scrape_url(cfg.search_url) or ""

    if not markdown:
        if trace:
            trace.record(
                "state_license",
                ran=True,
                reason="license page scrape failed",
                credits_est=3,
            )
        return enriched

    record = parse_license_record(markdown, url, cfg)
    if not record.has_data():
        if trace:
            trace.record(
                "state_license",
                ran=True,
                reason="license record parsed empty",
                credits_est=3,
            )
        return enriched

    enriched.facts = [*enriched.facts, *license_record_to_facts(record)]
    existing = {(c.name.casefold(), c.label) for c in enriched.site_contacts}
    for name, title, quote in license_contacts(record):
        key = (name.casefold(), title)
        if key not in existing:
            enriched.site_contacts = [
                *enriched.site_contacts,
                SiteContact(
                    label=title,
                    name=name,
                    source_url=record.url,
                    verification="verified",
                    quote=quote,
                    priority="best",
                ),
            ]
    if record.url not in enriched.evidence_urls:
        enriched.evidence_urls = [*enriched.evidence_urls, record.url]
    if "state_license" not in (enriched.source_tool or ""):
        enriched.source_tool = f"{enriched.source_tool}+state_license"

    if trace:
        trace.record(
            "state_license",
            ran=True,
            reason=f"{cfg.agency} record parsed",
            credits_est=3,
            outputs={
                "agency": cfg.agency,
                "license_id": record.license_id,
                "designated_officer": record.designated_officer or record.licensee_name,
            },
        )
    return enriched


def _try_linkedin_serp_tier(
    work_raw: RawLead,
    enriched: EnrichedLead,
    firecrawl: FirecrawlClient,
    tier_rules: EnrichmentRules,
    settings: Settings,
    *,
    trace: LeadEvalTrace | None = None,
) -> EnrichedLead:
    if "linkedin_serp" not in tier_rules.registry_lookups():
        if trace:
            trace.record("linkedin_serp", ran=False, reason="linkedin_serp not enabled")
        return enriched
    has_callable = any(
        is_callable_phone(c.phone) for c in enriched.site_contacts
    ) or is_callable_phone(enriched.main_phone)
    has_named = any(c.name.strip() for c in enriched.site_contacts)
    if not has_callable or has_named:
        if trace:
            trace.record(
                "linkedin_serp",
                ran=False,
                reason="needs callable phone without named person",
            )
        return enriched
    if _has_verified_person(enriched):
        if trace:
            trace.record("linkedin_serp", ran=False, reason="verified person already found")
        return enriched

    firecrawl.set_cost_context(stage="linkedin_serp")
    company = enriched.property_manager_or_ownership_clue
    if company in (None, "", NOT_FOUND):
        company = work_raw.business_name

    query = build_linkedin_query(work_raw, config_dir=settings.config_dir, company_name=company)
    results = firecrawl.search_web(query, limit=5)
    parsed = parse_linkedin_serp_results(results)
    if not parsed:
        if trace:
            trace.record(
                "linkedin_serp",
                ran=True,
                reason="no LinkedIn SERP matches",
                credits_est=2,
            )
        return enriched

    enriched.facts = [*enriched.facts, *linkedin_serp_facts(parsed, query=query)]
    if not any(c.verification in ("verified", "corroborated") for c in enriched.site_contacts):
        enriched.site_contacts = [
            *enriched.site_contacts,
            *[
                c.model_copy(update={"verification": "unverified"})
                for c in linkedin_serp_site_contacts(parsed)
            ],
        ]

    if trace:
        trace.record(
            "linkedin_serp",
            ran=True,
            reason=f"{len(parsed)} LinkedIn SERP contact(s)",
            credits_est=2,
            outputs={"contacts": [f"{n} — {r}" for n, r, _c, _l in parsed]},
        )
    return enriched


def _bbb_entity_seed(enriched: EnrichedLead) -> str:
    """Alternate legal entity from BBB facts — triggers SOS even when phone bar is met."""
    for fact in enriched.facts:
        if fact.fact_kind != "alternate_name" or fact.source_kind != "bbb":
            continue
        name = fact.value.get("name", "").strip()
        if name and re.search(
            r"\b(llc|l\.l\.c\.|inc|corp|corporation|lp|l\.p\.|trust|holdings|partners)\b",
            name,
            re.I,
        ):
            return name
    return ""


def _record_owner_chain_skip(
    *,
    store: LeadStore | None,
    run_id: str | None,
    place_id: str,
    business: str,
    reason: str,
    trace: LeadEvalTrace | None = None,
) -> None:
    if store and run_id:
        store.record_run_event(
            run_id=run_id,
            place_id=place_id,
            stage="owner_chain",
            ran=False,
            reason=reason,
            credits_est=0,
        )
        store.commit_events()
    progress_emit(
        "owner_chain_skip",
        place_id=place_id,
        business=business,
        reason=reason,
    )
    if trace:
        trace.record("owner_chain", ran=False, reason=reason)


def _try_owner_chain_tier(
    work_raw: RawLead,
    enriched: EnrichedLead,
    tier_rules: EnrichmentRules,
    settings: Settings,
    *,
    firecrawl: FirecrawlClient | None = None,
    store: LeadStore | None = None,
    run_id: str | None = None,
    trace: LeadEvalTrace | None = None,
) -> EnrichedLead:
    """County/state portal lookups when Firecrawl tiers did not meet the contact bar."""
    if not tier_rules.allow_owner_chain:
        _record_owner_chain_skip(
            store=store,
            run_id=run_id,
            place_id=work_raw.place_id,
            business=work_raw.business_name,
            reason="category disallows owner chain",
            trace=trace,
        )
        return enriched
    if not settings.firecrawl_api_key:
        _record_owner_chain_skip(
            store=store,
            run_id=run_id,
            place_id=work_raw.place_id,
            business=work_raw.business_name,
            reason="owner chain requires FIRECRAWL_API_KEY",
            trace=trace,
        )
        return enriched

    owner_count = store.run_stage_count(run_id, "owner_chain") if store and run_id else 0
    if store and run_id and not store.try_reserve_run_stage(
        run_id, "owner_chain", settings.owner_chain_max_per_run
    ):
        _record_owner_chain_skip(
            store=store,
            run_id=run_id,
            place_id=work_raw.place_id,
            business=work_raw.business_name,
            reason=f"cap reached ({settings.owner_chain_max_per_run})",
            trace=trace,
        )
        return enriched

    bbb_entity = _bbb_entity_seed(enriched)
    atomic_dm = has_atomic_named_decision_maker(enriched)
    met_before, bar_detail = enriched_meets_bar(enriched, tier_rules)
    # CRE: stop expensive owner-chain once we have a Partner-shaped named DM.
    # Other categories: stop when the sales contact bar is already met.
    cre = requires_named_decision_maker(work_raw.property_type)
    already_good = atomic_dm if cre else met_before
    if already_good and not bbb_entity:
        _record_owner_chain_skip(
            store=store,
            run_id=run_id,
            place_id=work_raw.place_id,
            business=work_raw.business_name,
            reason=(
                "atomic named DM already found"
                if cre and atomic_dm
                else f"contact bar already met: {bar_detail}"
            ),
            trace=trace,
        )
        return enriched

    chain = resolve_owner_chain(
        work_raw,
        enriched,
        tier_rules,
        settings=settings,
        store=store,
        firecrawl=firecrawl,
        owner_chain_count=owner_count,
        entity_seed=bbb_entity,
        run_id=run_id,
    )
    enriched = chain.enriched

    if store and run_id:
        store.record_run_event(
            run_id=run_id,
            place_id=work_raw.place_id,
            stage="owner_chain",
            ran=chain.ran,
            reason=chain.reason,
            credits_est=0,
        )
        if not chain.ran:
            progress_emit(
                "owner_chain_skip",
                place_id=work_raw.place_id,
                business=work_raw.business_name,
                reason=chain.reason,
            )
        # Firecrawl agent cost events are recorded by FirecrawlClient.
        store.commit_events()

    if trace:
        trace.record(
            "owner_chain",
            ran=chain.ran,
            reason=chain.reason,
            credits_est=0,
            outputs={
                "contact_improved": chain.contact_improved,
                "loopnet_used": chain.loopnet_used,
            },
        )

    return enriched


def _collect_pdf_snippets(
    firecrawl: FirecrawlClient,
    enriched: EnrichedLead,
    investigation: LeadInvestigationResult | None,
) -> list[str]:
    urls = list(enriched.evidence_urls)
    if investigation:
        urls.extend(investigation.source_urls)
    pdf_url = FirecrawlClient.pick_broker_pdf_url(urls)
    if not pdf_url:
        return []
    logger.info("  Broker PDF scrape: %s", pdf_url)
    snippet = firecrawl.scrape_pdf_snippet(pdf_url)
    return [snippet] if snippet else []


def _load_playbook(
    profile: LeadProfile,
    rules: EnrichmentRules,
    store: LeadStore | None,
    raw: RawLead,
) -> EnrichmentPlaybook:
    learned_data = store.get_playbook(profile.key) if store else None
    learned = EnrichmentPlaybook.from_dict(learned_data) if learned_data else None
    static = static_playbook_for(profile)
    mgmt: EnrichmentPlaybook | None = None
    mgmt_key = management_profile_key(raw.website)
    if mgmt_key and store:
        mgmt_data = store.get_playbook(mgmt_key)
        if mgmt_data:
            mgmt = EnrichmentPlaybook.from_dict(mgmt_data)
    return merge_playbooks(profile, static=static, learned=learned, mgmt=mgmt, rules=rules)


def _collect_contact_facts(enriched: EnrichedLead, raw: RawLead) -> list[LeadFact]:
    """Mirror site_contacts into the fact ledger.

    BBB principals are normally written by the BBB stage; if a BBB contact is on
    site_contacts without a matching person fact (partial/legacy runs), mirror it
    here so People / evidence stay aligned with best_contact and site_contacts.
    """
    facts: list[LeadFact] = []
    existing_person_names = {
        (fact.value.get("name") or "").strip().casefold()
        for fact in enriched.facts
        if fact.fact_kind == "person" and (fact.value.get("name") or "").strip()
    }
    existing_phones = {
        re.sub(r"\D", "", fact.value.get("phone") or "")[-10:]
        for fact in enriched.facts
        if fact.fact_kind == "phone" and fact.value.get("phone")
    }
    existing_phones.discard("")
    existing_emails = {
        (fact.value.get("email") or "").strip().casefold()
        for fact in enriched.facts
        if fact.fact_kind == "email" and (fact.value.get("email") or "").strip()
    }

    if raw.main_phone:
        main_digits = re.sub(r"\D", "", raw.main_phone)[-10:]
        if main_digits and main_digits not in existing_phones:
            facts.append(
                LeadFact(
                    fact_kind="phone",
                    value={"phone": raw.main_phone, "label": "Main line"},
                    source_kind="google_places",
                    source_url=raw.google_maps_url or "",
                    method="api",
                    quote="Business phone on the Google Places listing",
                    verification="verified",
                )
            )
            existing_phones.add(main_digits)

    for contact in enriched.site_contacts:
        if contact.label == "Main line (Google)":
            continue  # recorded above from the raw listing
        source_url = contact.source_url or ""
        source_kind = "bbb" if "bbb.org" in source_url else "website"
        method = "llm_extract" if contact.verification == "unverified" else "deterministic_parse"
        verification = contact.verification or "unverified"

        if contact.name:
            name_key = contact.name.strip().casefold()
            if name_key and name_key not in existing_person_names:
                person_value = {"name": contact.name, "title": contact.label}
                if contact.phone:
                    person_value["phone"] = contact.phone
                if contact.email:
                    person_value["email"] = contact.email
                facts.append(
                    LeadFact(
                        fact_kind="person",
                        value=person_value,
                        source_kind=source_kind,
                        source_url=source_url,
                        method=method,
                        quote=contact.quote,
                        verification=verification,
                    )
                )
                existing_person_names.add(name_key)

        if contact.phone:
            phone_digits = re.sub(r"\D", "", contact.phone)[-10:]
            if phone_digits and phone_digits not in existing_phones:
                label = contact.label
                if contact.name and contact.name.strip():
                    label = (
                        f"{contact.name.strip()} — {contact.label}"
                        if contact.label
                        else contact.name.strip()
                    )
                facts.append(
                    LeadFact(
                        fact_kind="phone",
                        value={"phone": contact.phone, "label": label},
                        source_kind=source_kind,
                        source_url=source_url,
                        method=method,
                        quote=contact.quote,
                        verification=verification,
                    )
                )
                existing_phones.add(phone_digits)

        if contact.email and "@" in contact.email:
            email_key = contact.email.strip().casefold()
            if email_key and email_key not in existing_emails:
                facts.append(
                    LeadFact(
                        fact_kind="email",
                        value={"email": contact.email, "label": contact.label},
                        source_kind=source_kind,
                        source_url=source_url,
                        method=method,
                        quote=contact.quote,
                        verification=verification,
                    )
                )
                existing_emails.add(email_key)

    return facts


def _persist_facts(
    store: LeadStore | None,
    run_id: str | None,
    enriched: EnrichedLead,
    *,
    rejections: list[Rejection] | None = None,
) -> None:
    if not store:
        return
    store.delete_facts_for_lead(enriched.place_id)
    for fact in enriched.facts:
        store.record_fact(
            place_id=enriched.place_id,
            fact_kind=fact.fact_kind,
            value=fact.value,
            source_kind=fact.source_kind,
            method=fact.method,
            verification=fact.verification,
            source_url=fact.source_url or None,
            quote=fact.quote or None,
            run_id=run_id,
        )
    for rejection in rejections or []:
        kind = rejection.kind
        fact_kind = "person" if kind == "name" else kind
        if fact_kind not in ("phone", "person", "email"):
            fact_kind = "person"
        if fact_kind == "person":
            value = {"name": rejection.value, "title": rejection.context}
        elif fact_kind == "phone":
            value = {"phone": rejection.value, "label": rejection.context}
        else:
            value = {"email": rejection.value, "label": rejection.context}
        store.record_fact(
            place_id=enriched.place_id,
            fact_kind=fact_kind,
            value=value,
            source_kind="website",
            method="llm_extract",
            verification="rejected",
            quote=f"{rejection.value}: {rejection.reason}",
            run_id=run_id,
        )
    store.commit_facts()


def _persist_trace_events(
    store: LeadStore | None,
    run_id: str | None,
    place_id: str,
    trace: LeadEvalTrace | None,
) -> int:
    if not store or not run_id or not trace:
        return 0
    total = 0
    for stage in trace.stages:
        store.record_run_event(
            run_id=run_id,
            place_id=place_id,
            stage=stage.stage,
            ran=stage.ran,
            reason=stage.reason,
            credits_est=stage.credits_est,
            meta={"inputs": stage.inputs, "outputs": stage.outputs},
        )
        total += stage.credits_est
    store.commit_events()
    return total


def _record_production_events(
    store: LeadStore | None,
    run_id: str | None,
    place_id: str,
    enriched: EnrichedLead,
    *,
    used_fast_path: bool,
) -> int:
    """Persist stage timing on production runs. Credits come from cost_events, not estimates."""
    if not store or not run_id:
        return 0

    def _evt(stage: str, ran: bool, reason: str = "") -> None:
        store.record_run_event(
            run_id=run_id,
            place_id=place_id,
            stage=stage,
            ran=ran,
            reason=reason,
            credits_est=0,
        )

    tool = enriched.source_tool or ""
    if used_fast_path or "profile_reuse" in tool:
        _evt("profile_fast_path", True, "franchise playbook fast path")
    else:
        if "search" in tool and "scrape_json" not in tool.split("+")[0]:
            _evt("website_resolve", True, "website gap-fill")
        if "map" in tool or "scrape" in tool:
            _evt("map", True, "Firecrawl map/scrape")
        if "scrape_json" in tool or "scrape" in tool:
            _evt("scrape", True, "Tier 1 scrape+JSON")
        if "search" in tool and "firecrawl_search" in tool:
            _evt("tier2_search", True, "Tier 2 search+scrape")

    _evt("lead_done", True, enriched.source_tool)
    store.commit_events()
    return store.lead_run_credits(run_id, place_id)


def _record_profile_learning(
    store: LeadStore | None,
    profile: LeadProfile,
    raw: RawLead,
    enriched: EnrichedLead,
    rules: EnrichmentRules,
    *,
    used_fast_path: bool,
    learn_profiles: bool,
) -> None:
    if not store or not learn_profiles:
        return
    update = learn_playbook_from_outcome(
        profile,
        raw,
        enriched,
        rules=rules,
        firecrawl_skipped=used_fast_path,
    )
    if update.trust_google_phone or update.typical_source_tool:
        store.record_profile_outcome(
            profile.key,
            property_type=profile.property_type,
            site_kind=profile.site_kind,
            brand=profile.brand,
            playbook_update=update.to_dict(),
            place_id=raw.place_id,
            increment_success=used_fast_path or update.trust_google_phone,
        )

    mgmt_result = learn_management_playbook(enriched, rules=rules)
    if mgmt_result:
        mgmt_key, mgmt_update = mgmt_result
        store.record_profile_outcome(
            mgmt_key,
            property_type="mgmt",
            site_kind="company",
            brand=mgmt_key.split(":", 1)[-1],
            playbook_update=mgmt_update.to_dict(),
            place_id=raw.place_id,
            increment_success=True,
        )


def _finish_profile_fast_path(
    raw: RawLead,
    settings: Settings,
    profile: LeadProfile,
    playbook: EnrichmentPlaybook,
    *,
    reason: str,
    store: LeadStore | None = None,
    run_id: str | None = None,
    trace: LeadEvalTrace | None = None,
) -> EnrichedLead:
    enriched = EnrichedLead.model_validate(raw.model_dump())
    enriched = apply_baseline_fields(enriched, raw)
    if enriched.best_contact_role in ("", NOT_FOUND):
        enriched.best_contact_role = playbook.contact_role_label
    enriched.investigation_status = InvestigationStatus.ENRICHED
    enriched.source_tool = "google_places+profile_reuse"
    enriched.notes = f"Profile fast path ({profile.key}): {reason}"
    enriched = scrub_unverified_website(enriched, store=store, verify_evidence=False)
    enriched = _apply_verification_fields(enriched)
    if trace:
        from pallares_leads.eval.score import contact_score, exterior_score

        trace.record(
            "profile_fast_path",
            ran=True,
            reason=reason,
            outputs={
                "profile_key": profile.key,
                "source_tool": enriched.source_tool,
                "phone": enriched.best_contact_phone,
            },
        )
        trace.record(
            "final",
            ran=True,
            reason="profile fast path complete",
            outputs={
                "source_tool": enriched.source_tool,
                "confidence": enriched.confidence.value,
                "sales_status": enriched.sales_status(),
            },
            quality={
                "contact_score": contact_score(enriched),
                "exterior_score": exterior_score(enriched),
            },
        )
    return enriched


def enrich_lead(
    raw: RawLead,
    firecrawl: FirecrawlClient | None,
    settings: Settings,
    *,
    trace: LeadEvalTrace | None = None,
    store: LeadStore | None = None,
    run_id: str | None = None,
    learn_profiles: bool = True,
) -> EnrichedLead:
    enriched = EnrichedLead.model_validate(raw.model_dump())
    investigation: LeadInvestigationResult | None = None
    pages_scraped = 0
    used_fast_path = False

    profile = classify_lead(raw)
    tier_rules = get_enrichment_rules(raw.property_type, settings.config_dir)
    playbook = _load_playbook(profile, tier_rules, store, raw)

    progress_emit(
        "lead_started",
        place_id=raw.place_id,
        business=raw.business_name,
        market=raw.market_key or None,
        category=raw.lead_category,
    )
    lead_started_at = time.perf_counter()

    if not firecrawl:
        enriched.investigation_status = InvestigationStatus.DISCOVERED
        enriched.source_tool = "google_places"
        if trace:
            trace.record(
                "final",
                ran=True,
                reason="no Firecrawl client",
                outputs={"source_tool": "google_places"},
            )
        enriched = apply_baseline_fields(enriched, raw)
        enriched.facts = [*_collect_contact_facts(enriched, raw), *enriched.facts]
        _persist_facts(store, run_id, enriched)
        _record_profile_learning(
            store,
            profile,
            raw,
            enriched,
            tier_rules,
            used_fast_path=False,
            learn_profiles=learn_profiles,
        )
        _persist_trace_events(store, run_id, raw.place_id, trace)
        if not trace:
            _record_production_events(
                store,
                run_id,
                raw.place_id,
                enriched,
                used_fast_path=False,
            )
        enriched = _apply_verification_fields(enriched)
        return _apply_lead_score(enriched)

    use_fast, fast_reason = should_use_profile_fast_path(raw, profile, playbook, tier_rules)
    if use_fast:
        logger.info("  Profile fast path for %s — %s", raw.business_name, fast_reason)
        used_fast_path = True
        enriched = _finish_profile_fast_path(
            raw, settings, profile, playbook, reason=fast_reason, store=store, trace=trace
        )
        _record_profile_learning(
            store,
            profile,
            raw,
            enriched,
            tier_rules,
            used_fast_path=True,
            learn_profiles=learn_profiles,
        )
        _persist_trace_events(store, run_id, raw.place_id, trace)
        if not trace:
            _record_production_events(
                store,
                run_id,
                raw.place_id,
                enriched,
                used_fast_path=True,
            )
        return _apply_lead_score(enriched)

    firecrawl.reset_session_credits()
    firecrawl.set_cost_context(run_id=run_id, place_id=raw.place_id)
    snap_base = _snapshot_path(settings, raw, ".json")
    gaps = GoogleGaps.from_lead(raw, enriched, config_dir=settings.config_dir)
    work_raw = raw

    if trace:
        trace.record(
            "gaps",
            ran=True,
            reason=gap_summary(gaps),
            inputs={
                "missing_website": gaps.missing_website,
                "missing_phone": gaps.missing_phone,
                "corporate_website": gaps.corporate_website,
                "missing_contact": gaps.missing_contact,
            },
        )

    if gaps.missing_website or gaps.corporate_website:
        with _enrichment_stage(
            "website_resolve",
            raw=raw,
            run_id=run_id,
            firecrawl=firecrawl,
        ):
            logger.info("  Google gaps: %s", gap_summary(gaps))
            work_raw = resolve_website(raw, enriched, firecrawl, gaps)
            if trace:
                search_info = firecrawl.last_search_info
                trace.record(
                    "search",
                    ran=True,
                    reason="missing website or corporate locator",
                    credits_est=1 if search_info.get("method") == "search_api" else 0,
                    inputs={
                        "query": search_info.get("query", ""),
                        "method": search_info.get("method", ""),
                    },
                    outputs={"found_url": search_info.get("found") or enriched.website or ""},
                )
            gaps = GoogleGaps.from_lead(work_raw, enriched, config_dir=settings.config_dir)

    # map + scrape+JSON → markdown fallback → Tier 2 search → leasing/PDF gap-fill
    tier1: LeadInvestigationResult | None = None
    if work_raw.website:
        with _enrichment_stage("scrape", raw=raw, run_id=run_id, firecrawl=firecrawl):
            tier1 = firecrawl.scrape_lead(work_raw)
            map_info = firecrawl.last_map_info
            if map_info:
                progress_emit(
                    "map",
                    place_id=raw.place_id,
                    business=raw.business_name,
                    run_id=run_id,
                    cached=bool(map_info.get("cached")),
                )
            if trace:
                trace.record(
                    "map",
                    ran=bool(map_info),
                    reason="cached hit" if map_info.get("cached") else "Firecrawl /map",
                    credits_est=0 if map_info.get("cached") else 1,
                    inputs={"website": work_raw.website},
                    outputs={"urls": map_info.get("urls", [])},
                )
            if tier1:
                FirecrawlClient.dump_snapshot(
                    snap_base.with_name(snap_base.stem + "_scrape_json.json"),
                    {"tier": "scrape_json", "result": tier1.model_dump()},
                )
                enriched = apply_investigation(
                    enriched, tier1, source_tool="google_places+firecrawl_scrape_json"
                )
                progress_emit(
                    "scrape_json",
                    place_id=raw.place_id,
                    business=raw.business_name,
                    run_id=run_id,
                )
                if trace:
                    trace.record(
                        "scrape_json",
                        ran=True,
                        reason="Tier 1 scrape+JSON",
                        credits_est=5,
                        inputs={"target_url": firecrawl.last_scrape_target},
                        outputs=_investigation_outputs(tier1),
                    )
            else:
                logger.info("  Tier 1 markdown scrape fallback")
                if trace:
                    trace.record(
                        "scrape_json",
                        ran=False,
                        reason="Tier 1 scrape+JSON returned no result",
                        credits_est=5,
                        inputs={"target_url": firecrawl.last_scrape_target},
                    )
                enriched, tier1 = _scrape_fallback(work_raw, firecrawl, enriched, settings)
                pages_scraped = len(enriched.evidence_urls)
                tier_rules = get_enrichment_rules(work_raw.property_type, settings.config_dir)
                if (
                    tier1
                    and investigation_meets_bar(
                        tier1, tier_rules, property_type=work_raw.property_type
                    )[0]
                ):
                    enriched = apply_investigation(
                        enriched, tier1, source_tool="google_places+firecrawl_scrape"
                    )
                if trace:
                    trace.record(
                        "markdown",
                        ran=pages_scraped > 0,
                        reason="markdown fallback after failed scrape+JSON",
                        credits_est=pages_scraped,
                        outputs={"pages_scraped": pages_scraped, "urls": enriched.evidence_urls},
                    )

    investigation = tier1
    tier_rules = get_enrichment_rules(work_raw.property_type, settings.config_dir)
    tier2_needed, tier2_reason = tier2_gap_reason(tier1, work_raw, gaps=gaps, settings=settings)
    # Even when the minimum bar is met, keep cheap tiers going until we have a
    # richer package (DM email and/or a second named DM) — not just the first hit.
    if not tier2_needed:
        pkg_needed, pkg_reason = needs_package_enrichment(enriched, tier_rules)
        if pkg_needed:
            tier2_needed = True
            tier2_reason = pkg_reason

    if tier2_needed:
        logger.info("  Tier 2 search gap-fill for %s (%s)", work_raw.business_name, tier2_reason)
        with _enrichment_stage("tier2_search", raw=raw, run_id=run_id, firecrawl=firecrawl):
            search_result = firecrawl.search_contact_gap(work_raw, tier_rules)
            if trace:
                search_info = firecrawl.last_contact_search_info
                trace.record(
                    "search_contact",
                    ran=search_result is not None,
                    reason=tier2_reason,
                    credits_est=6 if search_result else 1,
                    inputs={
                        "query": search_info.get("query", ""),
                        "candidates": search_info.get("candidates", []),
                    },
                    outputs=_investigation_outputs(search_result),
                )
            if search_result:
                FirecrawlClient.dump_snapshot(
                    snap_base.with_name(snap_base.stem + "_search_contact.json"),
                    {"tier": "search_contact", "result": search_result.model_dump()},
                )
                enriched = apply_investigation(
                    enriched, search_result, source_tool="google_places+firecrawl_search"
                )
                investigation = search_result
                if contact_package_complete(enriched):
                    tier2_needed = False
                    tier2_reason = "contact package complete after Tier 2"
                elif investigation_meets_bar(
                    search_result, tier_rules, property_type=work_raw.property_type
                )[0]:
                    # Bar met but package still thin — continue to leasing/BBB.
                    pkg_needed, pkg_reason = needs_package_enrichment(enriched, tier_rules)
                    tier2_needed = pkg_needed
                    tier2_reason = pkg_reason or (
                        f"Tier 2 met contact bar ({tier_rules.min_contact_bar})"
                    )

    if tier2_needed:
        with _enrichment_stage("leasing", raw=raw, run_id=run_id, firecrawl=firecrawl):
            enriched, investigation, leasing_met = _try_leasing_tier(
                work_raw,
                firecrawl,
                enriched,
                investigation,
                tier_rules,
                trace=trace,
            )
            if contact_package_complete(enriched):
                tier2_needed = False
                tier2_reason = "contact package complete after leasing/PDF"
            elif leasing_met:
                pkg_needed, pkg_reason = needs_package_enrichment(enriched, tier_rules)
                tier2_needed = pkg_needed
                tier2_reason = pkg_reason or "leasing/PDF tier met contact bar"

    if trace:
        trace.record(
            "tier2_gate",
            ran=True,
            reason=tier2_reason,
            outputs={"tier2_needed": tier2_needed},
        )

    with _enrichment_stage("pdf", raw=raw, run_id=run_id, firecrawl=firecrawl):
        pdf_snippets = _collect_pdf_snippets(firecrawl, enriched, investigation)
        if trace:
            pdf_url = FirecrawlClient.pick_broker_pdf_url(
                list(enriched.evidence_urls)
                + (investigation.source_urls if investigation else [])
            )
            trace.record(
                "pdf",
                ran=bool(pdf_snippets),
                reason="broker PDF scrape" if pdf_snippets else "no broker PDF URL",
                credits_est=1 if pdf_snippets else 0,
                inputs={"url": pdf_url or ""},
                outputs={"snippet_chars": len(pdf_snippets[0]) if pdf_snippets else 0},
            )

    with _enrichment_stage("bbb", raw=raw, run_id=run_id, firecrawl=firecrawl):
        enriched = _try_bbb_tier(
            work_raw,
            enriched,
            firecrawl,
            tier_rules,
            settings,
            trace=trace,
        )

    with _enrichment_stage("state_license", raw=raw, run_id=run_id, firecrawl=firecrawl):
        enriched = _try_license_tier(
            work_raw,
            enriched,
            firecrawl,
            tier_rules,
            settings,
            trace=trace,
        )

    # Expensive agent: CRE until a Partner-shaped named DM; other categories until
    # the sales contact bar. Never burn agent just to chase a second contact/email.
    atomic_pre_agent = has_atomic_named_decision_maker(enriched)
    bar_met_pre_agent, _ = enriched_meets_bar(enriched, tier_rules)
    cre_needs_dm = requires_named_decision_maker(work_raw.property_type)
    run_agent = (
        (cre_needs_dm and not atomic_pre_agent)
        or (not cre_needs_dm and not bar_met_pre_agent)
    )
    if (
        run_agent
        and firecrawl
        and not firecrawl.should_stop_expensive_stages()
        and settings.firecrawl_agent_max_credits > 0
    ):
        with _enrichment_stage("owner_chain", raw=raw, run_id=run_id, firecrawl=firecrawl):
            agent_result = firecrawl.run_capped_agent(work_raw)
            if agent_result:
                enriched = apply_investigation(
                    enriched, agent_result, source_tool="google_places+firecrawl_agent"
                )
                if trace:
                    trace.record(
                        "firecrawl_agent",
                        ran=True,
                        reason="capped agent filled contact gap",
                        credits_est=settings.firecrawl_agent_max_credits,
                    )
            elif trace:
                trace.record(
                    "firecrawl_agent",
                    ran=False,
                    reason="agent returned no grounded contact",
                )
    elif trace:
        trace.record(
            "firecrawl_agent",
            ran=False,
            reason="skipped — named DM/bar met, credit stop, or agent disabled",
        )

    with _enrichment_stage("owner_chain", raw=raw, run_id=run_id, firecrawl=firecrawl):
        enriched = _try_owner_chain_tier(
            work_raw,
            enriched,
            tier_rules,
            settings,
            firecrawl=firecrawl,
            store=store,
            run_id=run_id,
            trace=trace,
        )

    # LinkedIn last — never alone for verified (BBB/owner-chain should stamp first).
    with _enrichment_stage("linkedin_serp", raw=raw, run_id=run_id, firecrawl=firecrawl):
        enriched = _try_linkedin_serp_tier(
            work_raw,
            enriched,
            firecrawl,
            tier_rules,
            settings,
            trace=trace,
        )

    social_facts = social_facts_from_pages(firecrawl.session_markdown)
    if social_facts:
        enriched.facts = [*enriched.facts, *social_facts]
        logger.info("  Socials: %d profile link(s) found", len(social_facts))
    if trace:
        trace.record(
            "socials",
            ran=bool(social_facts),
            reason=f"{len(social_facts)} social profile link(s)" if social_facts else "none found",
            outputs={"links": [f.value.get("url", "") for f in social_facts]},
        )

    if tier_rules.insurance_keywords:
        insurance_facts = insurance_facts_from_pages(
            firecrawl.session_markdown, tier_rules.insurance_keywords
        )
        if insurance_facts:
            enriched.facts = [*enriched.facts, *insurance_facts]
            logger.info("  Insurance: %d mention(s) found", len(insurance_facts))

    bar_met, _bar_detail = enriched_meets_bar(enriched, tier_rules)
    pkg_needed, pkg_reason = needs_package_enrichment(enriched, tier_rules)
    if not bar_met or pkg_needed:
        with _enrichment_stage(
            "source_checklist",
            raw=raw,
            run_id=run_id,
            firecrawl=firecrawl,
        ):
            checklist_facts, checklist_results, checklist_contacts = run_source_checklist(
                work_raw,
                enriched,
                config_dir=settings.config_dir,
                scrape_url=firecrawl.scrape_url,
                max_pages=settings.source_checklist_max_pages,
            )
            if checklist_facts:
                enriched.facts = [*enriched.facts, *checklist_facts]
            if checklist_contacts:
                enriched.site_contacts = [*enriched.site_contacts, *checklist_contacts]
            if store and run_id and checklist_results:
                for item in checklist_results:
                    store.record_run_event(
                        run_id=run_id,
                        place_id=work_raw.place_id,
                        stage=f"source_check:{item.source_key}",
                        ran=item.status == "checked",
                        reason=f"{item.status}: {item.reason or item.url}",
                        credits_est=1 if item.status == "checked" else 0,
                    )
                store.commit_events()
            if trace and checklist_results:
                trace.record(
                    "source_checklist",
                    ran=True,
                    reason=pkg_reason or f"{len(checklist_results)} source(s) evaluated",
                    outputs={
                        "checks": [
                            {"source": r.source_key, "status": r.status, "url": r.url}
                            for r in checklist_results
                        ]
                    },
                )
    elif trace:
        trace.record("source_checklist", ran=False, reason="contact package complete")

    merge_firecrawl_into_lead(enriched, raw, investigation)
    finalize_enrichment_notes(enriched, raw, gaps, investigation)

    if enriched.investigation_status == InvestigationStatus.DISCOVERED and investigation:
        enriched.investigation_status = InvestigationStatus.ENRICHED

    enriched = apply_baseline_fields(enriched, raw)
    enriched = scrub_unverified_website(enriched, store=store, verify_evidence=False)
    enriched = _apply_verification_fields(enriched)
    enriched = _apply_lead_score(enriched)
    verified_dm = has_verified_named_decision_maker(enriched)
    atomic_dm = has_atomic_named_decision_maker(enriched)
    # CRE: ladder exhausted without a named DM is a researched miss even when a
    # Google/mainline phone made verification_level=partial — do not re-burn.
    # Non-CRE: partial phone evidence stays inventory; unverified becomes a miss.
    if requires_named_decision_maker(enriched.property_type) and not atomic_dm:
        researched_miss = True
        miss_note = "researched_miss: CRE ladder exhausted — no named decision-maker"
    else:
        researched_miss = not verified_dm and enriched.verification_level != "partial"
        miss_note = "researched_miss: no verified named decision-maker"

    if store and firecrawl and firecrawl.session_credits_used:
        store.commit_cost_events()

    enriched.facts = [*_collect_contact_facts(enriched, raw), *enriched.facts]
    rejections = firecrawl.session_rejections if firecrawl else []
    _persist_facts(store, run_id, enriched, rejections=rejections)

    # Operator signal: Ready DM exists but package is still thin (no email / no backup).
    if verified_dm:
        thin = contact_package_gaps(enriched)
        if thin:
            pkg_note = "package thin: " + ", ".join(thin)
            enriched.notes = f"{enriched.notes}; {pkg_note}" if enriched.notes else pkg_note

    if researched_miss:
        # Record the miss so skip_known will not re-research; hide from inventory.
        enriched.investigation_status = InvestigationStatus.SKIPPED
        enriched.notes = f"{enriched.notes}; {miss_note}" if enriched.notes else miss_note
        logger.info(
            "Researched miss %s — stored as skipped (score=%s, verification=%s)",
            raw.business_name,
            enriched.lead_score,
            enriched.verification_level,
        )
    elif enriched.investigation_status == InvestigationStatus.DISCOVERED and investigation:
        enriched.investigation_status = InvestigationStatus.ENRICHED
    elif (
        verified_dm or enriched.verification_level == "partial"
    ) and enriched.investigation_status != InvestigationStatus.NEEDS_MANUAL:
        enriched.investigation_status = InvestigationStatus.ENRICHED

    if trace:
        from pallares_leads.eval.score import contact_score, exterior_score

        trace.record(
            "final",
            ran=True,
            reason=(
                "researched miss — skipped inventory"
                if researched_miss
                else "enrichment complete"
            ),
            outputs={
                "source_tool": enriched.source_tool,
                "confidence": enriched.confidence.value,
                "verification_level": enriched.verification_level,
                "sales_status": enriched.sales_status(),
                "investigation_status": enriched.investigation_status.value,
            },
            quality={
                "contact_score": contact_score(enriched),
                "exterior_score": exterior_score(enriched),
            },
        )

    _record_profile_learning(
        store,
        profile,
        raw,
        enriched,
        tier_rules,
        used_fast_path=used_fast_path,
        learn_profiles=learn_profiles and verified_dm,
    )
    _persist_trace_events(store, run_id, raw.place_id, trace)
    if not trace:
        _record_production_events(
            store,
            run_id,
            raw.place_id,
            enriched,
            used_fast_path=used_fast_path,
        )
    progress_emit(
        "lead_done",
        place_id=raw.place_id,
        business=raw.business_name,
        market=raw.market_key or None,
        category=raw.lead_category,
        verification_level=enriched.verification_level,
        score=enriched.lead_score,
        researched_miss=researched_miss,
        credits=firecrawl.session_credits_used if firecrawl else 0,
        duration_ms=int((time.perf_counter() - lead_started_at) * 1000),
    )
    return enriched


def _investigation_outputs(result: LeadInvestigationResult | None) -> dict:
    if not result:
        return {"contacts": 0, "has_phone": False, "source_urls": []}
    return {
        "contacts": len(result.site_contacts),
        "has_phone": is_callable_phone(result.contact_phone),
        "contact_phone": result.contact_phone,
        "has_form": bool(result.contact_form_url),
        "exterior_signals_len": len(result.exterior_signals),
        "source_urls": result.source_urls[:10],
    }


def run_market_category(
    *,
    settings: Settings,
    market_key: str,
    market: MarketConfig,
    category_key: str,
    category: CategoryConfig,
    discover_only: bool = False,
    dry_run: bool = False,
    campaign_sink: list[EnrichedLead] | None = None,
    limit: int | None = None,
    skip_known: bool = True,
    force_refresh: bool = False,
    refresh_after_days: int | None = None,
    store: LeadStore | None = None,
    exclude_counties: list[str] | None = None,
    campaign_key: str | None = None,
) -> Path | None:
    if dry_run:
        for q in category.get("queries") or []:
            logger.info("[dry-run] Text search: %r in %s, %s", q, market["city"], market["state"])
        nearby = category.get("nearby_types")
        if nearby:
            logger.info("[dry-run] Nearby search types: %s", nearby)
        included = category.get("included_type")
        if included:
            logger.info("[dry-run] Text search includedType: %s", included)
        if limit:
            logger.info("[dry-run] Would cap at %d leads after dedupe", limit)
        return None

    own_store = store is None
    if store is None:
        store = LeadStore()

    run_id = store.start_run(
        run_type="market",
        market_key=market_key,
        category_key=category_key,
        campaign_key=campaign_key,
    )
    run_started_at = time.perf_counter()

    try:
        return _run_market_category_body(
            settings=settings,
            market_key=market_key,
            market=market,
            category_key=category_key,
            category=category,
            discover_only=discover_only,
            campaign_sink=campaign_sink,
            limit=limit,
            skip_known=skip_known,
            force_refresh=force_refresh,
            refresh_after_days=refresh_after_days,
            store=store,
            run_id=run_id,
            exclude_counties=exclude_counties,
        )
    except BaseException as exc:
        # Never leave a run stuck in 'running' when the process crashes or is killed.
        # Persist the real exception + best-effort counters from telemetry.
        fail = failure_fields(exc)
        logger.exception(
            "Market run failed %s / %s — %s",
            market_key,
            category_key,
            fail["stop_detail"],
        )
        snap = {
            "discovered_count": 0,
            "skipped_known_count": 0,
            "enriched_count": 0,
        }
        try:
            snap = store.run_progress_snapshot(run_id)
            store.finish_run(
                run_id,
                discovered_count=snap["discovered_count"],
                skipped_known_count=snap["skipped_known_count"],
                enriched_count=snap["enriched_count"],
                status="failed",
                stop_reason=fail["stop_reason"],
                stop_detail=fail["stop_detail"],
                error=fail["error"],
                duration_ms=int((time.perf_counter() - run_started_at) * 1000),
            )
            progress_emit(
                "run_failed",
                run_id=run_id,
                market=market_key,
                category=category_key,
                reason=fail["stop_detail"],
                discovered=snap["discovered_count"],
                skipped_known=snap["skipped_known_count"],
                enriched=snap["enriched_count"],
                duration_ms=int((time.perf_counter() - run_started_at) * 1000),
            )
        except Exception:
            logger.exception(
                "Failed to persist failure state for run %s (%s / %s) — forcing terminal",
                run_id,
                market_key,
                category_key,
            )
            try:
                store.finish_run(
                    run_id,
                    discovered_count=snap["discovered_count"],
                    skipped_known_count=snap["skipped_known_count"],
                    enriched_count=snap["enriched_count"],
                    status="failed",
                    stop_reason=fail["stop_reason"] or "exception",
                    stop_detail=fail["stop_detail"] or "finish_run failed",
                    error=fail["error"],
                    duration_ms=int((time.perf_counter() - run_started_at) * 1000),
                )
            except Exception:
                logger.exception(
                    "Hard finish_run also failed for %s — run may stay RUNNING",
                    run_id,
                )
        raise
    finally:
        if own_store:
            store.close()


def _run_market_category_body(
    *,
    settings: Settings,
    market_key: str,
    market: MarketConfig,
    category_key: str,
    category: CategoryConfig,
    discover_only: bool,
    campaign_sink: list[EnrichedLead] | None,
    limit: int | None,
    skip_known: bool,
    force_refresh: bool,
    refresh_after_days: int | None,
    store: LeadStore,
    run_id: str,
    exclude_counties: list[str] | None = None,
) -> Path | None:
    bind_progress(store, run_id=run_id)
    run_started_at = time.perf_counter()
    progress_emit(
        "run_started",
        run_id=run_id,
        market=market_key,
        category=category_key,
        discover_only=discover_only,
    )
    discovered = _discover_category(
        settings=settings,
        market_key=market_key,
        market=market,
        category=category,
        limit=limit,
        store=store,
        run_id=run_id,
    )
    if exclude_counties:
        all_markets = load_markets(settings.config_dir)
        discovered, county_skipped = filter_excluded_counties(
            discovered, exclude_counties, all_markets
        )
        if county_skipped:
            logger.info(
                "Skipped %d lead(s) in excluded counties %s",
                county_skipped,
                exclude_counties,
            )
    discovered, dup_skipped = dedupe_leads(discovered)
    if dup_skipped:
        logger.info("Skipped %d near-duplicate Google listing(s) in discovery", dup_skipped)
    if limit and len(discovered) > limit:
        discovered = discovered[:limit]
    progress_emit(
        "discovery_done",
        run_id=run_id,
        market=market_key,
        category=category_key,
        count=len(discovered),
    )
    store.update_run_counters(run_id, discovered_count=len(discovered))
    if not discovered:
        logger.info("Empty discovery for %s / %s", market_key, category_key)
        duration_ms = int((time.perf_counter() - run_started_at) * 1000)
        store.finish_run(
            run_id,
            discovered_count=0,
            skipped_known_count=0,
            enriched_count=0,
            status="completed",
            stop_reason="empty_discovery",
            duration_ms=duration_ms,
        )
        progress_emit(
            "run_done",
            run_id=run_id,
            market=market_key,
            category=category_key,
            discovered=0,
            skipped_known=0,
            enriched=0,
            reason="empty_discovery",
            duration_ms=duration_ms,
        )
        return None

    run_dir = _run_artifacts_dir(settings, run_id)
    raw_path = run_dir / f"raw_{market_key}_{category_key}.jsonl"
    for lead in discovered:
        append_jsonl(raw_path, lead.model_dump(mode="json"))

    raw_leads, skipped_known = store.filter_new_leads(
        discovered,
        skip_known=skip_known,
        force_refresh=force_refresh,
        refresh_after_days=refresh_after_days,
    )
    if skipped_known:
        logger.info(
            "Skipped %d known lead(s) already in configured database",
            skipped_known,
        )
    # Discovery dud gate: cancel out-of-green places (e.g. temporarily closed) BEFORE
    # any paid enrichment and store them with a reason so they are never re-scraped.
    kept_leads: list[RawLead] = []
    discovery_duds = 0
    for raw in raw_leads:
        dud_reason = discovery_dud_reason(raw)
        if dud_reason:
            store.mark_dud(
                raw.place_id,
                reason=dud_reason,
                business_name=raw.business_name,
                market_key=market_key,
                category_key=category_key,
                city=raw.city,
                run_id=run_id,
            )
            discovery_duds += 1
        else:
            kept_leads.append(raw)
    raw_leads = kept_leads
    if discovery_duds:
        logger.info(
            "Discovery dud gate cancelled %d out-of-green lead(s) before enrichment",
            discovery_duds,
        )

    store.update_run_counters(
        run_id,
        discovered_count=len(discovered),
        skipped_known_count=skipped_known,
    )
    for raw in raw_leads:
        # Progress events reference leads by FK, so seed discovered rows before enrichment.
        store.touch_discovered(
            raw,
            market_key=market_key,
            category_key=category_key,
            run_id=run_id,
        )
    if not raw_leads:
        logger.info("No new leads to process for %s / %s", market_key, category_key)
        store.finish_run(
            run_id,
            discovered_count=len(discovered),
            skipped_known_count=skipped_known,
            enriched_count=0,
        )
        _write_run_manifest(
            settings,
            store,
            run_id=run_id,
            market_key=market_key,
            category_key=category_key,
            raw_path=raw_path,
            export_path=None,
            discovered_count=len(discovered),
            skipped_known_count=skipped_known,
            enriched_count=0,
        )
        progress_emit(
            "run_done",
            run_id=run_id,
            market=market_key,
            category=category_key,
            discovered=len(discovered),
            skipped_known=skipped_known,
            enriched=0,
            reason="no new leads — all already in the database",
            duration_ms=int((time.perf_counter() - run_started_at) * 1000),
        )
        return None

    firecrawl: FirecrawlClient | None = None
    if not discover_only:
        if not settings.firecrawl_api_key:
            logger.warning(
                "FIRECRAWL_API_KEY missing — running discover-only for %s / %s",
                market_key,
                category_key,
            )
        else:
            firecrawl = FirecrawlClient(settings, store=store)
            # Live team remaining beats local ledger — stop before spending if empty.
            usage = firecrawl.get_team_credit_usage()
            if not usage.get("error"):
                rem_raw = usage.get("remainingCredits", usage.get("remaining_credits"))
                try:
                    remaining = float(rem_raw) if rem_raw is not None else None
                except (TypeError, ValueError):
                    remaining = None
                if remaining is not None and remaining <= 0:
                    logger.warning(
                        "Firecrawl team remaining is %.0f — skipping enrich for %s/%s",
                        remaining,
                        market_key,
                        category_key,
                    )
                    duration_ms = int((time.perf_counter() - run_started_at) * 1000)
                    store.finish_run(
                        run_id,
                        discovered_count=len(discovered),
                        skipped_known_count=skipped_known,
                        enriched_count=0,
                        status="firecrawl_credits_exhausted",
                        stop_reason="firecrawl_credits_exhausted",
                        stop_detail="team remaining <= 0",
                        duration_ms=duration_ms,
                    )
                    progress_emit(
                        "run_done",
                        run_id=run_id,
                        market=market_key,
                        category=category_key,
                        discovered=len(discovered),
                        skipped_known=skipped_known,
                        enriched=0,
                        reason="firecrawl team credits exhausted",
                        duration_ms=duration_ms,
                    )
                    return None
            logger.info(
                "Firecrawl concurrency for run: %d (plan-driven)",
                firecrawl.effective_max_concurrency(),
            )

    enriched: list[EnrichedLead] = []

    def _persist_lead(lead: EnrichedLead, *, client: FirecrawlClient | None = None) -> None:
        if discover_only:
            return
        profile_key = classify_lead(RawLead.model_validate(lead.model_dump())).key
        mgmt_key = management_profile_key(lead.website)
        if firecrawl or not discover_only:
            store.upsert_enriched(
                lead,
                market_key=market_key,
                category_key=category_key,
                run_id=run_id,
                csv_path=None,
                profile_key=profile_key,
                mgmt_profile_key=mgmt_key,
                credits_total=store.lead_run_credits(run_id, lead.place_id) or None,
                lead_score=lead.lead_score,
            )
            store.commit_cost_events()
            # Phase B dud gate: a terminal researched miss that is also unreachable
            # (no callable phone anywhere and no live website) is a dud — stamp the
            # reason so it is never re-scraped. Runs after upsert_enriched, and
            # mark_dud only flips status + reason, so enriched_json is preserved.
            if lead.investigation_status == InvestigationStatus.SKIPPED:
                dud_reason = terminal_dud_reason(lead, website_alive=bool(lead.website))
                if dud_reason:
                    store.mark_dud(
                        lead.place_id,
                        reason=dud_reason,
                        business_name=lead.business_name,
                        market_key=market_key,
                        category_key=category_key,
                        city=lead.city,
                        run_id=run_id,
                    )
        owner = store.get_owner_record(lead.place_id) or {}
        principals = owner.get("principals_json") or []
        if isinstance(principals, str):
            try:
                principals = json.loads(principals)
            except json.JSONDecodeError:
                principals = []
        bbb_facts = [
            f
            for f in lead.facts
            if getattr(f, "fact_kind", "") == "registry_rating"
            or (isinstance(f, dict) and f.get("fact_kind") == "registry_rating")
        ]
        bbb_rating = ""
        bbb_years = None
        if bbb_facts:
            val = getattr(bbb_facts[0], "value", None) or bbb_facts[0].get("value", {})
            if isinstance(val, dict):
                bbb_rating = str(val.get("rating") or val.get("bbb_rating") or "")
                years_raw = val.get("years_in_business")
                if years_raw is not None:
                    try:
                        bbb_years = int(years_raw)
                    except (TypeError, ValueError):
                        bbb_years = None
        features = build_feature_snapshot(
            lead,
            run_id=run_id,
            category_key=category_key,
            profile_key=profile_key,
            owner_record_present=bool(owner),
            owner_kind=str(owner.get("owner_kind") or ""),
            principals_count=len(principals) if isinstance(principals, list) else 0,
            bbb_rating=bbb_rating,
            bbb_years_in_business=bbb_years,
            grounding_rejections_count=len(client.session_rejections) if client else 0,
            model="",
            cost_summary={
                "credits_total": store.lead_run_credits(run_id, lead.place_id),
                "usd_total": store.lead_cost_usd(run_id, lead.place_id),
            },
        )
        store.upsert_lead_features(
            lead.place_id,
            run_id,
            features,
            feature_version=FEATURE_VERSION,
        )

    def _do_enrich(
        raw: RawLead,
        client: FirecrawlClient | None,
        *,
        active_store: LeadStore | None = None,
    ) -> EnrichedLead:
        enrich_store = active_store or store

        def _baseline_discovered(*, notes: str = "") -> EnrichedLead:
            started = time.perf_counter()
            progress_emit(
                "lead_started",
                place_id=raw.place_id,
                business=raw.business_name,
                market=market_key,
                category=category_key,
            )
            lead = EnrichedLead.model_validate(raw.model_dump())
            lead.source_tool = "google_places"
            lead.investigation_status = InvestigationStatus.DISCOVERED
            if notes:
                lead.notes = notes
            lead = apply_baseline_fields(lead, raw)
            progress_emit(
                "lead_done",
                place_id=raw.place_id,
                business=raw.business_name,
                market=market_key,
                category=category_key,
                verification_level=lead.verification_level,
                score=lead.lead_score,
                credits=0,
                duration_ms=int((time.perf_counter() - started) * 1000),
            )
            return lead

        if not enrich_store.claim_place_for_enrichment(raw.place_id, run_id=run_id):
            logger.info("Place %s already claimed — skipping parallel double-enrich", raw.place_id)
            # Winner owns persistence — return a marker lead so we never overwrite them.
            started = time.perf_counter()
            progress_emit(
                "lead_started",
                place_id=raw.place_id,
                business=raw.business_name,
                market=market_key,
                category=category_key,
            )
            skipped = EnrichedLead.model_validate(raw.model_dump())
            skipped.source_tool = "google_places"
            skipped.investigation_status = InvestigationStatus.DISCOVERED
            skipped.notes = "__claim_skip__"
            progress_emit(
                "lead_done",
                place_id=raw.place_id,
                business=raw.business_name,
                market=market_key,
                category=category_key,
                verification_level=skipped.verification_level,
                score=skipped.lead_score,
                credits=0,
                duration_ms=int((time.perf_counter() - started) * 1000),
            )
            return skipped

        if client:
            try:
                return enrich_lead(
                    raw,
                    client,
                    settings,
                    store=enrich_store,
                    run_id=run_id,
                    learn_profiles=True,
                )
            except Exception as exc:
                # Persist-on-fail: keep partial progress so skip_known quality gate can retry later.
                logger.exception("Enrichment failed for %s — persisting partial", raw.business_name)
                partial = EnrichedLead.model_validate(raw.model_dump())
                partial = apply_baseline_fields(partial, raw)
                partial.investigation_status = InvestigationStatus.DISCOVERED
                partial.notes = f"enrichment failed: {str(exc)[:180]}"
                partial.lead_score = compute_lead_score(partial)
                try:
                    enrich_store.upsert_enriched(
                        partial,
                        market_key=market_key,
                        category_key=category_key,
                        run_id=run_id,
                        profile_key=classify_lead(raw).key,
                        mgmt_profile_key=management_profile_key(raw.website),
                        lead_score=partial.lead_score,
                    )
                finally:
                    # upsert may no-op (vendor guard); never leave enriching stuck.
                    enrich_store.release_enrichment_claim(
                        raw.place_id, status="partial"
                    )
                raise
        return _baseline_discovered()

    plan_info: dict[str, object] = {}
    if firecrawl:
        plan_info = firecrawl.refresh_plan_limits()
        progress_emit(
            "firecrawl_plan",
            run_id=run_id,
            market=market_key,
            category=category_key,
            plan_name=plan_info.get("plan_name"),
            plan_key=plan_info.get("plan_key"),
            max_concurrency=plan_info.get("max_concurrency"),
            place_workers=plan_info.get("place_workers"),
            credits_remaining=plan_info.get("credits_remaining"),
        )
    workers = max(1, firecrawl.effective_parallel_workers()) if firecrawl else 1
    if workers > 1:
        logger.info(
            "Parallel research: %d workers for %d leads (Firecrawl %s · %s browsers)",
            workers,
            len(raw_leads),
            plan_info.get("plan_name") or plan_info.get("plan_key") or "plan",
            plan_info.get("max_concurrency") or "?",
        )

    credits_exhausted = False
    lead_timeout_s = max(60, int(settings.enrichment_lead_timeout_s))
    # Shared with heartbeat so the dock can surface "stuck on N leads".
    inflight_state: dict[str, object] = {
        "pending": 0,
        "stalled": [],
        "done": 0,
        "total": len(raw_leads),
    }
    inflight_lock = threading.Lock()

    heartbeat_stop = threading.Event()

    def _bump_live_counters() -> None:
        """Keep runs.*_count current so the Runs table is not stuck at 0/0/0."""
        store.update_run_counters(
            run_id,
            discovered_count=len(discovered),
            skipped_known_count=skipped_known,
            enriched_count=len(enriched),
        )

    def _heartbeat_loop() -> None:
        while not heartbeat_stop.wait(30):
            with inflight_lock:
                pending_n = int(inflight_state.get("pending") or 0)
                stalled = list(inflight_state.get("stalled") or [])  # type: ignore[arg-type]
                done_n = int(inflight_state.get("done") or 0)
                total_n = int(inflight_state.get("total") or 0)
            progress_emit(
                "heartbeat",
                run_id=run_id,
                market=market_key,
                category=category_key,
                pending=pending_n,
                done=done_n,
                total=total_n,
                stalled=stalled[:5],
            )
            try:
                _bump_live_counters()
            except Exception:
                logger.debug("heartbeat counter bump failed", exc_info=True)

    def _mark_lead_timeout(raw: RawLead) -> None:
        logger.error(
            "Lead enrichment timed out after %ss — abandoning %s so the cell can finish",
            lead_timeout_s,
            raw.business_name,
        )
        progress_emit(
            "lead_failed",
            place_id=raw.place_id,
            business=raw.business_name,
            market=market_key,
            category=category_key,
            run_id=run_id,
            reason=f"enrichment_timeout_{lead_timeout_s}s",
        )
        store.release_enrichment_claim(raw.place_id, status="partial")

    heartbeat_thread = threading.Thread(target=_heartbeat_loop, daemon=True)
    heartbeat_thread.start()
    try:
        if workers > 1 and firecrawl and len(raw_leads) > 1:

            def _worker(raw: RawLead) -> EnrichedLead:
                with LeadStore(store.db_url) as worker_store:
                    bind_progress(worker_store, run_id=run_id)
                    client = FirecrawlClient(settings, store=worker_store)
                    # Inherit the parent's live plan ceiling (avoid N queue-status probes).
                    if firecrawl is not None:
                        client._plan_max_concurrency = firecrawl.plan_max_concurrency()
                        client._resolved_concurrency = firecrawl.effective_max_concurrency()
                    return _do_enrich(raw, client, active_store=worker_store)

            pool = ThreadPoolExecutor(max_workers=min(workers, len(raw_leads)))
            futures = {pool.submit(_worker, raw): raw for raw in raw_leads}
            started_at = {fut: time.monotonic() for fut in futures}
            pending = set(futures)
            completed_n = 0
            with inflight_lock:
                inflight_state["pending"] = len(pending)
                inflight_state["done"] = 0
            try:
                while pending:
                    done_set, pending = wait(
                        pending, timeout=5.0, return_when=FIRST_COMPLETED
                    )
                    now = time.monotonic()
                    # Abandon leads that exceeded the wall-clock budget.
                    for fut in list(pending):
                        if now - started_at[fut] < lead_timeout_s:
                            continue
                        pending.discard(fut)
                        raw = futures[fut]
                        _mark_lead_timeout(raw)
                        completed_n += 1
                        with inflight_lock:
                            inflight_state["pending"] = len(pending)
                            inflight_state["done"] = completed_n
                            stalled = list(inflight_state.get("stalled") or [])
                            if raw.business_name not in stalled:
                                stalled.append(raw.business_name)
                            inflight_state["stalled"] = stalled
                    stalled_names = [
                        futures[f].business_name
                        for f in pending
                        if now - started_at[f] >= max(120, lead_timeout_s // 3)
                    ]
                    with inflight_lock:
                        inflight_state["pending"] = len(pending)
                        inflight_state["stalled"] = stalled_names
                    for future in done_set:
                        if future not in futures:
                            continue
                        raw = futures[future]
                        try:
                            result = future.result()
                            if result.notes != "__claim_skip__":
                                enriched.append(result)
                                _persist_lead(result, client=firecrawl)
                            completed_n += 1
                            _bump_live_counters()
                            with inflight_lock:
                                inflight_state["done"] = completed_n
                                inflight_state["pending"] = len(pending)
                            logger.info(
                                "[%d/%d] %s — done",
                                completed_n,
                                len(raw_leads),
                                raw.business_name,
                            )
                        except OutOfCreditsError:
                            credits_exhausted = True
                            logger.error(
                                "Firecrawl credits exhausted — stopping enrichment"
                            )
                            progress_emit(
                                "credits_exhausted",
                                run_id=run_id,
                                reason="firecrawl_credits_exhausted",
                            )
                            pending.clear()
                            break
                        except Exception as exc:
                            completed_n += 1
                            logger.exception(
                                "Enrichment failed for %s", raw.business_name
                            )
                            progress_emit(
                                "lead_failed",
                                place_id=raw.place_id,
                                business=raw.business_name,
                                market=market_key,
                                category=category_key,
                                run_id=run_id,
                                reason=str(exc)[:200],
                            )
                            with inflight_lock:
                                inflight_state["done"] = completed_n
                                inflight_state["pending"] = len(pending)
            finally:
                # Do not block the campaign forever on zombie agent threads.
                pool.shutdown(wait=False, cancel_futures=True)
            order = {r.place_id: idx for idx, r in enumerate(raw_leads)}
            enriched.sort(key=lambda lead: order.get(lead.place_id, 999))
        else:
            for i, raw in enumerate(raw_leads, start=1):
                if credits_exhausted:
                    break
                logger.info("[%d/%d] %s — enriching", i, len(raw_leads), raw.business_name)
                with inflight_lock:
                    inflight_state["pending"] = 1
                    inflight_state["done"] = i - 1
                    inflight_state["stalled"] = []
                one = ThreadPoolExecutor(max_workers=1)
                fut = one.submit(_do_enrich, raw, firecrawl)
                try:
                    result = fut.result(timeout=lead_timeout_s)
                except FuturesTimeoutError:
                    _mark_lead_timeout(raw)
                    one.shutdown(wait=False, cancel_futures=True)
                    continue
                except OutOfCreditsError:
                    credits_exhausted = True
                    logger.error("Firecrawl credits exhausted — stopping enrichment")
                    progress_emit(
                        "credits_exhausted",
                        run_id=run_id,
                        reason="firecrawl_credits_exhausted",
                    )
                    one.shutdown(wait=False, cancel_futures=True)
                    break
                except Exception as exc:
                    logger.exception("Enrichment failed for %s", raw.business_name)
                    progress_emit(
                        "lead_failed",
                        place_id=raw.place_id,
                        business=raw.business_name,
                        market=market_key,
                        category=category_key,
                        run_id=run_id,
                        reason=str(exc)[:200],
                    )
                    one.shutdown(wait=False, cancel_futures=True)
                    continue
                else:
                    one.shutdown(wait=False, cancel_futures=True)
                if result.notes != "__claim_skip__":
                    enriched.append(result)
                    _persist_lead(result, client=firecrawl)
                _bump_live_counters()
                with inflight_lock:
                    inflight_state["done"] = i
                    inflight_state["pending"] = 0
    finally:
        heartbeat_stop.set()
        # Give the daemon heartbeat one moment to exit so a late
        # update_run_counters cannot race finish_run on the same store lock.
        heartbeat_thread.join(timeout=2.0)

    out_path = run_dir / "export.csv"
    export_csv(enriched, out_path)
    logger.info("Wrote %d leads to %s", len(enriched), out_path)

    if campaign_sink is not None:
        campaign_sink.extend(enriched)

    csv_str = str(out_path)
    for lead in enriched:
        if firecrawl and not discover_only:
            store.update_lead_csv_path(lead.place_id, csv_str)
        else:
            raw = RawLead.model_validate(lead.model_dump())
            store.touch_discovered(
                raw,
                market_key=market_key,
                category_key=category_key,
                run_id=run_id,
            )
    duration_ms = int((time.perf_counter() - run_started_at) * 1000)
    verified_dm_count = sum(1 for lead in enriched if has_verified_named_decision_maker(lead))
    grounding_rejections = len(firecrawl.session_rejections) if firecrawl else None
    if credits_exhausted:
        store.finish_run(
            run_id,
            discovered_count=len(discovered),
            skipped_known_count=skipped_known,
            enriched_count=len(enriched),
            status="firecrawl_credits_exhausted",
            stop_reason="firecrawl_credits_exhausted",
            duration_ms=duration_ms,
            verified_dm_count=verified_dm_count,
            grounding_rejections=grounding_rejections,
        )
    else:
        store.finish_run(
            run_id,
            discovered_count=len(discovered),
            skipped_known_count=skipped_known,
            enriched_count=len(enriched),
            status="completed",
            duration_ms=duration_ms,
            verified_dm_count=verified_dm_count,
            grounding_rejections=grounding_rejections,
        )
    store.wal_checkpoint()
    _write_run_manifest(
        settings,
        store,
        run_id=run_id,
        market_key=market_key,
        category_key=category_key,
        raw_path=raw_path,
        export_path=out_path,
        discovered_count=len(discovered),
        skipped_known_count=skipped_known,
        enriched_count=len(enriched),
    )
    progress_emit(
        "run_done",
        run_id=run_id,
        market=market_key,
        category=category_key,
        discovered=len(discovered),
        skipped_known=skipped_known,
        enriched=len(enriched),
        credits=store.run_credits_total(run_id),
        duration_ms=duration_ms,
    )

    return out_path

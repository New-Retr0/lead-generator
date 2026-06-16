from __future__ import annotations

import json
import logging
import re
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import TYPE_CHECKING

from pallares_leads.config_loader import CategoryConfig, MarketConfig
from pallares_leads.db.store import LeadStore
from pallares_leads.discover.overpass import OverpassClient
from pallares_leads.discover.places import PlacesClient
from pallares_leads.enrich.ai_gateway_client import gateway_configured, set_gateway_parallel_workers
from pallares_leads.enrich.apply import (
    apply_baseline_fields,
    apply_investigation,
    derive_best_contact_fields,
)
from pallares_leads.enrich.browser_use_client import BrowserUseClient
from pallares_leads.enrich.contact_extract import (
    exterior_signals,
    merge_page_contacts,
    property_manager_clues,
)
from pallares_leads.enrich.contact_requirements import (
    EnrichmentRules,
    enriched_meets_bar,
    get_enrichment_rules,
    investigation_meets_bar,
    is_callable_phone,
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
    lookup_config_for_state,
    parse_license_record,
    should_run_license_lookup,
)
from pallares_leads.enrich.insurance import insurance_facts_from_pages
from pallares_leads.enrich.sales_copy import maybe_enrich_sales_copy
from pallares_leads.enrich.schema import LeadInvestigationResult
from pallares_leads.enrich.socials import social_facts_from_pages
from pallares_leads.enrich.source_checklist import run_source_checklist
from pallares_leads.pipeline.dedupe import dedupe_leads
from pallares_leads.pipeline.export_csv import export_csv
from pallares_leads.pipeline.export_sheets import export_sheets, sheets_configured
from pallares_leads.progress import emit as progress_emit
from pallares_leads.resolve.contact_hierarchy import pick_best_contact
from pallares_leads.resolve.lead_score import compute_lead_score
from pallares_leads.resolve.verification import (
    compute_verification_level,
    verification_to_confidence,
)
from pallares_leads.schemas import (
    NOT_FOUND,
    Confidence,
    EnrichedLead,
    InvestigationStatus,
    LeadFact,
    RawLead,
    SiteContact,
)
from pallares_leads.settings import Settings
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
    source = category.get("source", "places")
    if source == "overpass":
        client = OverpassClient(settings)
        return client.discover_category(
            market_key=market_key,
            market=market,
            category=category,
            limit=limit,
        )
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


def _scrape_fallback(
    raw: RawLead,
    firecrawl: FirecrawlClient,
    enriched: EnrichedLead,
) -> tuple[EnrichedLead, LeadInvestigationResult | None]:
    """Markdown fallback: deterministic regex extraction (proximity-window pairing)."""
    pages = firecrawl.scrape_site(raw.website or "")
    if not pages:
        return enriched, None

    combined = ""
    evidence: list[str] = []
    for url, md in pages:
        evidence.append(url)
        combined += md + "\n"

    contacts = merge_page_contacts(pages)
    site_contacts = [
        SiteContact(
            label=c.role or c.contact_type.replace("_", " ").title(),
            name=c.name or "",
            phone=c.phone or "",
            email=(c.email_or_form or "") if "@" in (c.email_or_form or "") else "",
            priority="good",
            source_url=c.source_url or "",
            # Deterministic regex parse of fetched text — verified at birth.
            verification="verified",
            quote=c.quote or "",
        )
        for c in contacts
        if c.contact_type != "contact_form"
    ]

    clue = property_manager_clues(combined)
    if clue:
        enriched.property_manager_or_ownership_clue = clue
        enriched.management_source_url = pages[0][0]

    enriched.exterior_cleaning_need_signals = exterior_signals(combined, raw.property_type)
    enriched.evidence_urls = list(dict.fromkeys([*enriched.evidence_urls, *evidence]))

    best = pick_best_contact(contacts, property_type=raw.property_type)
    form = next((c for c in contacts if c.contact_type == "contact_form"), None)
    result = LeadInvestigationResult(
        site_contacts=site_contacts,
        contact_name=(best.name or "") if best else "",
        contact_role=(best.role or "") if best else "",
        contact_phone=(best.phone or "") if best else "",
        contact_email=(
            (best.email_or_form or "") if best and "@" in (best.email_or_form or "") else ""
        ),
        contact_form_url=(form.source_url or "") if form else "",
        property_manager=clue or "",
        exterior_signals=enriched.exterior_cleaning_need_signals,
        source_urls=evidence,
    )
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

    pdf_snippets = _collect_pdf_snippets(firecrawl, enriched, investigation)
    if pdf_snippets and trace:
        trace.record(
            "pdf",
            ran=True,
            reason="broker PDF gap-fill",
            credits_est=1,
            outputs={"snippet_chars": len(pdf_snippets[0])},
        )
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
    if _has_verified_person(enriched):
        if trace:
            trace.record("bbb", ran=False, reason="verified person already found")
        return enriched

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
    new_contacts = bbb_contacts(profile)
    existing_keys = {(c.name.casefold(), c.phone) for c in enriched.site_contacts}
    for contact in new_contacts:
        if (contact.name.casefold(), contact.phone) not in existing_keys:
            enriched.site_contacts = [*enriched.site_contacts, contact]

    enriched.facts = [*enriched.facts, *bbb_profile_to_facts(profile)]
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
    if enriched_meets_bar(enriched, tier_rules)[0] and not tier_rules.require_property_manager_clue:
        if trace:
            trace.record("state_license", ran=False, reason="contact bar already met")
        return enriched

    cfg = lookup_config_for_state(work_raw.state, config_dir=settings.config_dir)
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
    if _has_verified_person(enriched):
        if trace:
            trace.record("linkedin_serp", ran=False, reason="verified person already found")
        return enriched

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
            *linkedin_serp_site_contacts(parsed),
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


def _append_related_talking_points(
    enriched: EnrichedLead,
    store: LeadStore | None,
) -> None:
    if not store:
        return
    related = store.related_leads(enriched.place_id, limit=3)
    if not related:
        return
    for item in related:
        line = (
            f"• Also {item['relation'].replace('_', ' ')}: "
            f"{item['business_name']} ({item.get('city') or 'local'}) — bundle pitch"
        )
        if line not in (enriched.sales_talking_points or ""):
            enriched.sales_talking_points = (
                f"{(enriched.sales_talking_points or '').rstrip()}\n{line}".strip()
            )


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
    if not settings.browser_use_enabled:
        _record_owner_chain_skip(
            store=store,
            run_id=run_id,
            place_id=work_raw.place_id,
            business=work_raw.business_name,
            reason="browser use disabled",
            trace=trace,
        )
        return enriched

    owner_count = store.run_stage_count(run_id, "owner_chain") if store and run_id else 0
    loopnet_count = store.run_stage_count(run_id, "loopnet") if store and run_id else 0
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
    met_before, bar_detail = enriched_meets_bar(enriched, tier_rules)
    if met_before and not bbb_entity:
        _record_owner_chain_skip(
            store=store,
            run_id=run_id,
            place_id=work_raw.place_id,
            business=work_raw.business_name,
            reason=f"contact bar already met: {bar_detail}",
            trace=trace,
        )
        return enriched

    browser = BrowserUseClient(settings, store=store, run_id=run_id, place_id=work_raw.place_id)
    chain = resolve_owner_chain(
        work_raw,
        enriched,
        tier_rules,
        settings=settings,
        store=store,
        browser=browser,
        owner_chain_count=owner_count,
        loopnet_count=loopnet_count,
        entity_seed=bbb_entity,
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
        if chain.loopnet_used:
            store.record_run_event(
                run_id=run_id,
                place_id=work_raw.place_id,
                stage="loopnet",
                ran=True,
                reason="LoopNet listing lookup",
                credits_est=0,
            )
        # Per-task browser_use cost events are recorded by BrowserUseClient itself.
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
                "cost_usd": browser.total_cost_usd,
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
    """Mirror site_contacts into the fact ledger (BBB contacts are already facts)."""
    facts: list[LeadFact] = []
    if raw.main_phone:
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
    for contact in enriched.site_contacts:
        if "bbb.org" in (contact.source_url or ""):
            continue  # already recorded by the BBB stage
        if contact.label == "Main line (Google)":
            continue  # recorded above from the raw listing
        method = "llm_extract" if contact.verification == "unverified" else "deterministic_parse"
        if contact.name:
            facts.append(
                LeadFact(
                    fact_kind="person",
                    value={"name": contact.name, "title": contact.label, "phone": contact.phone},
                    source_kind="website",
                    source_url=contact.source_url,
                    method=method,
                    quote=contact.quote,
                    verification=contact.verification or "unverified",
                )
            )
        elif contact.phone:
            facts.append(
                LeadFact(
                    fact_kind="phone",
                    value={"phone": contact.phone, "label": contact.label},
                    source_kind="website",
                    source_url=contact.source_url,
                    method=method,
                    quote=contact.quote,
                    verification=contact.verification or "unverified",
                )
            )
        elif contact.email:
            facts.append(
                LeadFact(
                    fact_kind="email",
                    value={"email": contact.email, "label": contact.label},
                    source_kind="website",
                    source_url=contact.source_url,
                    method=method,
                    quote=contact.quote,
                    verification=contact.verification or "unverified",
                )
            )
    return facts


def _persist_facts(
    store: LeadStore | None,
    run_id: str | None,
    enriched: EnrichedLead,
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
    """Persist stage credits on production runs (no eval trace)."""
    if not store or not run_id:
        return 0
    total = 0
    tool = enriched.source_tool or ""

    def _evt(stage: str, ran: bool, credits: int, reason: str = "") -> None:
        nonlocal total
        store.record_run_event(
            run_id=run_id,
            place_id=place_id,
            stage=stage,
            ran=ran,
            reason=reason,
            credits_est=credits,
        )
        total += credits

    if used_fast_path or "profile_reuse" in tool:
        _evt("profile_fast_path", True, 0, "franchise playbook fast path")
        _evt("gateway", bool(enriched.why_this_is_a_good_fit), 0, "AI sales copy")
    else:
        if "search" in tool and "scrape_json" not in tool.split("+")[0]:
            _evt("search", True, 1, "website gap-fill")
        if "map" in tool or "scrape" in tool:
            _evt("map", True, 1, "Firecrawl /map")
        if "scrape_json" in tool:
            _evt("scrape_json", True, 5, "Tier 1 scrape+JSON")
        elif "scrape" in tool:
            _evt("markdown", True, 3, "markdown scrape")
        if "search" in tool and "firecrawl_search" in tool:
            _evt("search_contact", True, 6, "Tier 2 search+JSON")
        _evt("gateway", bool(enriched.why_this_is_a_good_fit), 0, "AI sales copy")

    _evt("final", True, 0, enriched.source_tool)
    store.commit_events()
    return total


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
    enriched = maybe_enrich_sales_copy(
        enriched, raw, None, [], settings, trace=trace, store=store, run_id=run_id
    )
    enriched = _apply_verification_fields(enriched)
    if trace:
        from pallares_leads.eval.score import contact_score, copy_score, exterior_score

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
                "copy_score": copy_score(enriched),
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
        category=raw.lead_category,
    )

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
            enriched, tier1 = _scrape_fallback(work_raw, firecrawl, enriched)
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

    if tier2_needed:
        logger.info("  Tier 2 search gap-fill for %s", work_raw.business_name)
        search_result = firecrawl.search_contact_gap(work_raw, tier_rules)
        if trace:
            search_info = firecrawl.last_contact_search_info
            trace.record(
                "search_contact",
                ran=search_result is not None,
                reason="contact bar not met after Tier 1",
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
            if investigation_meets_bar(
                search_result, tier_rules, property_type=work_raw.property_type
            )[0]:
                tier2_needed = False
                tier2_reason = f"Tier 2 search met contact bar ({tier_rules.min_contact_bar})"

    if tier2_needed:
        enriched, investigation, leasing_met = _try_leasing_tier(
            work_raw,
            firecrawl,
            enriched,
            investigation,
            tier_rules,
            trace=trace,
        )
        if leasing_met:
            tier2_needed = False
            tier2_reason = "leasing/PDF tier met contact bar"

    if trace:
        trace.record(
            "tier2_gate",
            ran=True,
            reason=tier2_reason,
            outputs={"tier2_needed": tier2_needed},
        )

    pdf_snippets = _collect_pdf_snippets(firecrawl, enriched, investigation)
    if trace:
        pdf_url = FirecrawlClient.pick_broker_pdf_url(
            list(enriched.evidence_urls) + (investigation.source_urls if investigation else [])
        )
        trace.record(
            "pdf",
            ran=bool(pdf_snippets),
            reason="broker PDF scrape" if pdf_snippets else "no broker PDF URL",
            credits_est=1 if pdf_snippets else 0,
            inputs={"url": pdf_url or ""},
            outputs={"snippet_chars": len(pdf_snippets[0]) if pdf_snippets else 0},
        )

    enriched = _try_bbb_tier(
        work_raw,
        enriched,
        firecrawl,
        tier_rules,
        settings,
        trace=trace,
    )

    enriched = _try_license_tier(
        work_raw,
        enriched,
        firecrawl,
        tier_rules,
        settings,
        trace=trace,
    )

    enriched = _try_linkedin_serp_tier(
        work_raw,
        enriched,
        firecrawl,
        tier_rules,
        settings,
        trace=trace,
    )

    enriched = _try_owner_chain_tier(
        work_raw,
        enriched,
        tier_rules,
        settings,
        store=store,
        run_id=run_id,
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
    if not bar_met:
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
                reason=f"{len(checklist_results)} source(s) evaluated",
                outputs={
                    "checks": [
                        {"source": r.source_key, "status": r.status, "url": r.url}
                        for r in checklist_results
                    ]
                },
            )
    elif trace:
        trace.record("source_checklist", ran=False, reason="contact bar already met")

    merge_firecrawl_into_lead(enriched, raw, investigation)
    finalize_enrichment_notes(enriched, raw, gaps, investigation)

    if enriched.investigation_status == InvestigationStatus.DISCOVERED and investigation:
        enriched.investigation_status = InvestigationStatus.ENRICHED

    enriched = apply_baseline_fields(enriched, raw)
    enriched = scrub_unverified_website(enriched, store=store, verify_evidence=False)
    enriched = maybe_enrich_sales_copy(
        enriched,
        raw,
        investigation,
        pdf_snippets,
        settings,
        trace=trace,
        store=store,
        run_id=run_id,
    )
    _append_related_talking_points(enriched, store)
    if store and firecrawl and firecrawl.session_credits_used:
        store.commit_cost_events()

    enriched.facts = [*_collect_contact_facts(enriched, raw), *enriched.facts]
    _persist_facts(store, run_id, enriched)
    enriched = _apply_verification_fields(enriched)

    if trace:
        from pallares_leads.eval.score import contact_score, copy_score, exterior_score

        trace.record(
            "final",
            ran=True,
            reason="enrichment complete",
            outputs={
                "source_tool": enriched.source_tool,
                "confidence": enriched.confidence.value,
                "verification_level": enriched.verification_level,
                "sales_status": enriched.sales_status(),
            },
            quality={
                "contact_score": contact_score(enriched),
                "copy_score": copy_score(enriched),
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
        learn_profiles=learn_profiles,
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
    enriched = _apply_lead_score(enriched)
    progress_emit(
        "lead_done",
        place_id=raw.place_id,
        business=raw.business_name,
        verification_level=enriched.verification_level,
        score=enriched.lead_score,
        credits=firecrawl.session_credits_used if firecrawl else 0,
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
    skip_sheets: bool = False,
    defer_sheets: bool = False,
    campaign_sink: list[EnrichedLead] | None = None,
    limit: int | None = None,
    skip_known: bool = True,
    force_refresh: bool = False,
    refresh_after_days: int | None = None,
    store: LeadStore | None = None,
) -> Path | None:
    if dry_run:
        source = category.get("source", "places")
        if source == "overpass":
            logger.info(
                "[dry-run] Overpass query filter=%s area=%s-%s m² in %s, %s",
                category.get("overpass_filter"),
                category.get("area_min_m2"),
                category.get("area_max_m2"),
                market["city"],
                market["state"],
            )
        else:
            for q in category.get("queries") or []:
                logger.info(
                    "[dry-run] Text search: %r in %s, %s", q, market["city"], market["state"]
                )
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
    )

    try:
        return _run_market_category_body(
            settings=settings,
            market_key=market_key,
            market=market,
            category_key=category_key,
            category=category,
            discover_only=discover_only,
            skip_sheets=skip_sheets or defer_sheets,
            defer_sheets=defer_sheets,
            campaign_sink=campaign_sink,
            limit=limit,
            skip_known=skip_known,
            force_refresh=force_refresh,
            refresh_after_days=refresh_after_days,
            store=store,
            run_id=run_id,
        )
    except BaseException:
        # Never leave a run stuck in 'running' when the process crashes or is killed.
        store.finish_run(
            run_id,
            discovered_count=0,
            skipped_known_count=0,
            enriched_count=0,
            status="failed",
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
    skip_sheets: bool,
    defer_sheets: bool,
    campaign_sink: list[EnrichedLead] | None,
    limit: int | None,
    skip_known: bool,
    force_refresh: bool,
    refresh_after_days: int | None,
    store: LeadStore,
    run_id: str,
) -> Path | None:
    progress_emit(
        "run_started",
        run_id=run_id,
        market=market_key,
        category=category_key,
        discover_only=discover_only,
    )
    stop = settings.firecrawl_session_credit_stop
    if stop > 0:
        used = store.total_firecrawl_credits()
        if used >= stop:
            logger.warning(
                "Session credit stop reached (%d >= %d) — skipping %s/%s",
                used,
                stop,
                market_key,
                category_key,
            )
            store.finish_run(
                run_id,
                discovered_count=0,
                skipped_known_count=0,
                enriched_count=0,
            )
            progress_emit(
                "run_done",
                run_id=run_id,
                discovered=0,
                skipped_known=0,
                enriched=0,
                reason=f"session credit stop ({used}/{stop})",
            )
            return None
    discovered = _discover_category(
        settings=settings,
        market_key=market_key,
        market=market,
        category=category,
        limit=limit,
        store=store,
        run_id=run_id,
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
            "Skipped %d known lead(s) already in %s",
            skipped_known,
            store.db_path.name,
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
            discovered=len(discovered),
            skipped_known=skipped_known,
            enriched=0,
            reason="no new leads — all already in the database",
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

    enriched: list[EnrichedLead] = []

    def _credits_budget_exceeded() -> bool:
        cap = settings.firecrawl_max_credits_per_run
        if cap <= 0:
            return False
        used = store.run_credits_total(run_id)
        return used >= cap

    def _persist_lead(lead: EnrichedLead) -> None:
        if not firecrawl or discover_only:
            return
        store.upsert_enriched(
            lead,
            market_key=market_key,
            category_key=category_key,
            run_id=run_id,
            csv_path=None,
            profile_key=classify_lead(RawLead.model_validate(lead.model_dump())).key,
            credits_total=store.lead_run_credits(run_id, lead.place_id) or None,
            lead_score=lead.lead_score,
        )

    def _do_enrich(
        raw: RawLead,
        client: FirecrawlClient | None,
        *,
        active_store: LeadStore | None = None,
    ) -> EnrichedLead:
        enrich_store = active_store or store
        if _credits_budget_exceeded():
            logger.warning(
                "Firecrawl credit cap reached (%d) — skipping enrichment for %s",
                settings.firecrawl_max_credits_per_run,
                raw.business_name,
            )
            lead = EnrichedLead.model_validate(raw.model_dump())
            lead.source_tool = "google_places"
            lead.investigation_status = InvestigationStatus.DISCOVERED
            lead.notes = (
                f"Skipped enrichment: run credit cap ({settings.firecrawl_max_credits_per_run})"
            )
            return apply_baseline_fields(lead, raw)
        if client:
            return enrich_lead(
                raw,
                client,
                settings,
                store=enrich_store,
                run_id=run_id,
                learn_profiles=True,
            )
        lead = EnrichedLead.model_validate(raw.model_dump())
        lead.source_tool = "google_places"
        lead.investigation_status = InvestigationStatus.DISCOVERED
        return apply_baseline_fields(lead, raw)

    workers = max(1, settings.enrichment_parallel_workers)
    if workers > 1 and gateway_configured(settings):
        interval = settings.ai_gateway_min_interval_s * workers
        logger.info(
            "Parallel enrichment: %d workers for %d leads — Firecrawl concurrent; "
            "AI Gateway serialized at %.1fs min spacing (%.1fs × workers)",
            workers,
            len(raw_leads),
            interval,
            settings.ai_gateway_min_interval_s,
        )
        set_gateway_parallel_workers(workers)
    else:
        set_gateway_parallel_workers(1)

    heartbeat_stop = threading.Event()

    def _heartbeat_loop() -> None:
        while not heartbeat_stop.wait(30):
            progress_emit("heartbeat", run_id=run_id)

    heartbeat_thread = threading.Thread(target=_heartbeat_loop, daemon=True)
    heartbeat_thread.start()
    try:
        if workers > 1 and firecrawl and len(raw_leads) > 1:

            def _worker(raw: RawLead) -> EnrichedLead:
                with LeadStore(store.db_url) as worker_store:
                    client = FirecrawlClient(settings, store=worker_store)
                    return _do_enrich(raw, client, active_store=worker_store)

            try:
                with ThreadPoolExecutor(max_workers=min(workers, len(raw_leads))) as pool:
                    futures = {pool.submit(_worker, raw): raw for raw in raw_leads}
                    for i, future in enumerate(as_completed(futures), start=1):
                        raw = futures[future]
                        try:
                            result = future.result()
                            enriched.append(result)
                            _persist_lead(result)
                            logger.info(
                                "[%d/%d] %s — done", i, len(raw_leads), raw.business_name
                            )
                        except Exception as exc:
                            logger.exception("Enrichment failed for %s", raw.business_name)
                            progress_emit(
                                "lead_failed",
                                place_id=raw.place_id,
                                business=raw.business_name,
                                run_id=run_id,
                                reason=str(exc)[:200],
                            )
            finally:
                set_gateway_parallel_workers(1)
            order = {r.place_id: idx for idx, r in enumerate(raw_leads)}
            enriched.sort(key=lambda lead: order.get(lead.place_id, 999))
        else:
            for i, raw in enumerate(raw_leads, start=1):
                logger.info("[%d/%d] %s — enriching", i, len(raw_leads), raw.business_name)
                result = _do_enrich(raw, firecrawl)
                enriched.append(result)
                _persist_lead(result)
    finally:
        heartbeat_stop.set()

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
    store.finish_run(
        run_id,
        discovered_count=len(discovered),
        skipped_known_count=skipped_known,
        enriched_count=len(enriched),
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
        discovered=len(discovered),
        skipped_known=skipped_known,
        enriched=len(enriched),
        credits=store.run_credits_total(run_id),
    )

    if sheets_configured(settings) and not skip_sheets:
        try:
            added = export_sheets(enriched, settings, crm_status_map=store.get_crm_statuses())
            logger.info("Google Sheets: %d new row(s) appended", added)
        except Exception:
            logger.exception("Google Sheets export failed")

    return out_path

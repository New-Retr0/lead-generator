from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING

from pallares_leads.config_loader import CategoryConfig, MarketConfig
from pallares_leads.discover.places import PlacesClient
from pallares_leads.enrich.apply import apply_baseline_fields, apply_investigation
from pallares_leads.enrich.gap_fill import (
    finalize_enrichment_notes,
    merge_firecrawl_into_lead,
    resolve_website,
)
from pallares_leads.enrich.domain_verify import scrub_unverified_website
from pallares_leads.enrich.contact_requirements import (
    agent_followup_reason,
    agent_permitted,
    EnrichmentRules,
    get_enrichment_rules,
    investigation_meets_bar,
)
from pallares_leads.enrich.google_gaps import GoogleGaps, gap_summary
from pallares_leads.enrich.contact_extract import (
    exterior_signals,
    merge_page_contacts,
    property_manager_clues,
)
from pallares_leads.enrich.firecrawl_client import FirecrawlClient
from pallares_leads.enrich.sales_copy import maybe_enrich_sales_copy
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
from pallares_leads.enrich.contact_requirements import is_callable_phone
from pallares_leads.enrich.schema import LeadInvestigationResult
from pallares_leads.db.store import LeadStore
from pallares_leads.pipeline.dedupe import dedupe_leads
from pallares_leads.pipeline.export_csv import export_csv
from pallares_leads.pipeline.export_sheets import export_sheets, sheets_configured
from pallares_leads.resolve.confidence import score_confidence
from pallares_leads.resolve.contact_hierarchy import contact_to_fields, pick_best_contact
from pallares_leads.schemas import EnrichedLead, InvestigationStatus, NOT_FOUND, RawLead
from pallares_leads.settings import Settings
from pallares_leads.utils.normalize import slugify
from pallares_leads.utils.snapshots import append_jsonl

if TYPE_CHECKING:
    from pallares_leads.eval.trace import LeadEvalTrace

logger = logging.getLogger(__name__)


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
    pages = firecrawl.scrape_site(raw.website or "")
    if not pages:
        return enriched, None

    combined = ""
    evidence: list[str] = []
    for url, md in pages:
        evidence.append(url)
        combined += md + "\n"

    contacts = merge_page_contacts(pages)
    best = pick_best_contact(contacts, property_type=raw.property_type)
    for key, value in contact_to_fields(best).items():
        setattr(enriched, key, value)

    clue = property_manager_clues(combined)
    if clue:
        enriched.property_manager_or_ownership_clue = clue
        enriched.management_source_url = pages[0][0]

    enriched.exterior_cleaning_need_signals = exterior_signals(combined, raw.property_type)
    enriched.evidence_urls = evidence

    result = LeadInvestigationResult(
        contact_name=enriched.best_contact_name if enriched.best_contact_name != NOT_FOUND else "",
        contact_role=enriched.best_contact_role if enriched.best_contact_role != NOT_FOUND else "",
        contact_phone=enriched.best_contact_phone if enriched.best_contact_phone != NOT_FOUND else "",
        contact_email=(
            enriched.best_contact_email_or_form
            if enriched.best_contact_email_or_form != NOT_FOUND
            and "@" in enriched.best_contact_email_or_form
            else ""
        ),
        property_manager=(
            enriched.property_manager_or_ownership_clue
            if enriched.property_manager_or_ownership_clue != NOT_FOUND
            else ""
        ),
        exterior_signals=enriched.exterior_cleaning_need_signals,
        source_urls=evidence,
    )
    return enriched, result


def _try_leasing_tier_before_agent(
    work_raw: RawLead,
    firecrawl: FirecrawlClient,
    enriched: EnrichedLead,
    investigation: LeadInvestigationResult | None,
    tier_rules: EnrichmentRules,
    *,
    trace: LeadEvalTrace | None = None,
) -> tuple[EnrichedLead, LeadInvestigationResult | None, bool]:
    """Map leasing/management URLs and broker PDFs before expensive Agent."""
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
                reason="leasing/management URL before Agent",
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
            reason="broker PDF before Agent",
            credits_est=1,
            outputs={"snippet_chars": len(pdf_snippets[0])},
        )
    return enriched, investigation, improved


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
    agent_ran: bool,
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
        _evt("agent", agent_ran, 75 if agent_ran else 0, "Agent" if agent_ran else "skipped")
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
    agent_ran: bool,
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
        agent_ran=agent_ran,
        firecrawl_skipped=used_fast_path,
    )
    if update.trust_google_phone or update.skip_agent or update.typical_source_tool:
        store.record_profile_outcome(
            profile.key,
            property_type=profile.property_type,
            site_kind=profile.site_kind,
            brand=profile.brand,
            playbook_update=update.to_dict(),
            place_id=raw.place_id,
            increment_success=used_fast_path or update.trust_google_phone or update.skip_agent,
        )

    mgmt_result = learn_management_playbook(enriched, rules=rules, agent_ran=agent_ran)
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
    enriched = maybe_enrich_sales_copy(enriched, raw, None, [], settings, trace=trace)
    enriched.confidence = score_confidence(
        enriched, None, pages_scraped=0, investigation=None
    )
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
    mode = settings.firecrawl_enrichment_mode
    investigation: LeadInvestigationResult | None = None
    pages_scraped = 0
    best = None
    agent_ran = False
    used_fast_path = False

    profile = classify_lead(raw)
    tier_rules = get_enrichment_rules(raw.property_type, settings.config_dir)
    playbook = _load_playbook(profile, tier_rules, store, raw)

    if not firecrawl:
        enriched.investigation_status = InvestigationStatus.DISCOVERED
        enriched.source_tool = "google_places"
        if trace:
            trace.record("final", ran=True, reason="no Firecrawl client", outputs={"source_tool": "google_places"})
        enriched = apply_baseline_fields(enriched, raw)
        _record_profile_learning(
            store, profile, raw, enriched, tier_rules,
            agent_ran=False, used_fast_path=False, learn_profiles=learn_profiles,
        )
        _persist_trace_events(store, run_id, raw.place_id, trace)
        if not trace:
            _record_production_events(
                store, run_id, raw.place_id, enriched,
                used_fast_path=False, agent_ran=False,
            )
        return enriched

    use_fast, fast_reason = should_use_profile_fast_path(raw, profile, playbook, tier_rules)
    if use_fast:
        logger.info("  Profile fast path for %s — %s", raw.business_name, fast_reason)
        used_fast_path = True
        enriched = _finish_profile_fast_path(
            raw, settings, profile, playbook, reason=fast_reason, store=store, trace=trace
        )
        _record_profile_learning(
            store, profile, raw, enriched, tier_rules,
            agent_ran=False, used_fast_path=True, learn_profiles=learn_profiles,
        )
        _persist_trace_events(store, run_id, raw.place_id, trace)
        if not trace:
            _record_production_events(
                store, run_id, raw.place_id, enriched,
                used_fast_path=True, agent_ran=False,
            )
        return enriched

    firecrawl.reset_map_cache()
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
                inputs={"query": search_info.get("query", ""), "method": search_info.get("method", "")},
                outputs={"found_url": search_info.get("found") or enriched.website or ""},
            )
        gaps = GoogleGaps.from_lead(work_raw, enriched, config_dir=settings.config_dir)

    if mode == "agent_only":
        focus = [u for u in [work_raw.website, work_raw.google_maps_url] if u]
        investigation = firecrawl.investigate_lead(work_raw, focus_urls=focus)
        if investigation:
            agent_ran = True
            FirecrawlClient.dump_snapshot(
                snap_base, {"tier": "agent", "result": investigation.model_dump()}
            )
            enriched = apply_investigation(enriched, investigation, source_tool="google_places+firecrawl_agent")
        if trace:
            trace.record(
                "agent",
                ran=investigation is not None,
                reason="agent_only mode",
                credits_est=settings.firecrawl_agent_max_credits if investigation else 0,
                outputs=_investigation_outputs(investigation),
            )
    elif mode == "scrape_only" and work_raw.website:
        enriched, investigation = _scrape_fallback(work_raw, firecrawl, enriched)
        pages_scraped = len(enriched.evidence_urls)
        if investigation:
            enriched = apply_investigation(enriched, investigation, source_tool="google_places+firecrawl_scrape")
        if trace:
            trace.record(
                "markdown",
                ran=pages_scraped > 0,
                reason="scrape_only mode",
                credits_est=pages_scraped,
                outputs={"pages_scraped": pages_scraped, "urls": enriched.evidence_urls},
            )
    else:
        # hybrid: map + scrape+JSON → markdown scrape fallback → agent
        tier1: LeadInvestigationResult | None = None
        if work_raw.website:
            tier1 = firecrawl.scrape_lead(work_raw)
            map_info = firecrawl.last_map_info
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
                if tier1 and investigation_meets_bar(tier1, tier_rules, property_type=work_raw.property_type)[0]:
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
        pre_agent_phone = enriched.best_contact_phone
        agent_needed, agent_reason = agent_followup_reason(
            tier1, work_raw, gaps=gaps, settings=settings
        )

        if agent_needed:
            logger.info("  Tier 2 search gap-fill for %s", work_raw.business_name)
            search_result = firecrawl.search_contact_gap(work_raw, tier_rules)
            if trace:
                search_info = firecrawl.last_contact_search_info
                trace.record(
                    "search_contact",
                    ran=search_result is not None,
                    reason="contact bar not met after Tier 1",
                    credits_est=6 if search_result else 1,
                    inputs={"query": search_info.get("query", ""), "candidates": search_info.get("candidates", [])},
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
                if investigation_meets_bar(search_result, tier_rules, property_type=work_raw.property_type)[0]:
                    agent_needed = False
                    agent_reason = f"Tier 2 search met contact bar ({tier_rules.min_contact_bar})"

        if agent_needed:
            enriched, investigation, leasing_met = _try_leasing_tier_before_agent(
                work_raw,
                firecrawl,
                enriched,
                investigation,
                tier_rules,
                trace=trace,
            )
            if leasing_met:
                agent_needed = False
                agent_reason = "leasing/PDF tier met contact bar before Agent"

        if agent_needed:
            learned_skip = playbook.skip_agent and (
                playbook.success_count > 0 or bool(playbook.winning_tier)
            )
            if learned_skip:
                met, bar_detail = enriched_meets_bar(enriched, tier_rules)
                if not met:
                    learned_skip = False
                    agent_reason = f"learned skip overridden: {bar_detail}"
            if learned_skip:
                agent_needed = False
                agent_reason = (
                    f"learned playbook skips Agent "
                    f"({playbook.winning_tier or profile.key})"
                )

        if trace:
            trace.agent_gate_reason = agent_reason
            trace.record(
                "agent_gate",
                ran=True,
                reason=agent_reason,
                outputs={"agent_needed": agent_needed},
            )

        if agent_needed:
            permitted, permit_reason = agent_permitted(work_raw, tier_rules, settings)
            if not permitted:
                logger.info("  Agent skipped: %s", permit_reason)
                agent_reason = permit_reason
                if trace:
                    trace.record("agent", ran=False, reason=permit_reason)
            else:
                focus = [u for u in [work_raw.website, work_raw.google_maps_url] if u]
                logger.info("  Tier 3 agent (last resort) for %s", work_raw.business_name)
                agent_result = firecrawl.investigate_lead(work_raw, focus_urls=focus)
                if agent_result:
                    agent_ran = True
                    FirecrawlClient.dump_snapshot(
                        snap_base.with_name(snap_base.stem + "_agent.json"),
                        {"tier": "agent", "result": agent_result.model_dump()},
                    )
                    enriched = apply_investigation(
                        enriched, agent_result, source_tool="google_places+firecrawl_agent"
                    )
                    investigation = agent_result
                if trace:
                    outputs = _investigation_outputs(agent_result)
                    outputs["added_phone"] = bool(
                        agent_result
                        and agent_result.contact_phone
                        and pre_agent_phone in ("", NOT_FOUND)
                    )
                    outputs["added_broker_source"] = any(
                        "loopnet" in u.lower() or "showcase" in u.lower()
                        for u in (agent_result.source_urls if agent_result else [])
                    )
                    trace.record(
                        "agent",
                        ran=agent_result is not None,
                        reason=agent_reason,
                        credits_est=settings.firecrawl_agent_max_credits if agent_result else 0,
                        outputs=outputs,
                    )
        elif trace:
            trace.record("agent", ran=False, reason=agent_reason)

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

    merge_firecrawl_into_lead(enriched, raw, investigation)
    finalize_enrichment_notes(enriched, raw, gaps, investigation)

    if enriched.investigation_status == InvestigationStatus.DISCOVERED and investigation:
        enriched.investigation_status = InvestigationStatus.ENRICHED

    enriched = apply_baseline_fields(enriched, raw)
    enriched = scrub_unverified_website(enriched, store=store, verify_evidence=False)
    enriched = maybe_enrich_sales_copy(
        enriched, raw, investigation, pdf_snippets, settings, trace=trace
    )
    enriched.confidence = score_confidence(
        enriched, best, pages_scraped=pages_scraped, investigation=investigation
    )

    if trace:
        from pallares_leads.eval.score import contact_score, copy_score, exterior_score

        trace.record(
            "final",
            ran=True,
            reason="enrichment complete",
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

    _record_profile_learning(
        store, profile, raw, enriched, tier_rules,
        agent_ran=agent_ran, used_fast_path=used_fast_path, learn_profiles=learn_profiles,
    )
    _persist_trace_events(store, run_id, raw.place_id, trace)
    if not trace:
        _record_production_events(
            store, run_id, raw.place_id, enriched,
            used_fast_path=used_fast_path, agent_ran=agent_ran,
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
        for q in category["queries"]:
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
        store = LeadStore(settings.db_path)

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
    places = PlacesClient(settings)
    discovered = places.discover_category(
        market_key=market_key,
        market=market,
        category=category,
        limit=limit,
    )
    discovered, dup_skipped = dedupe_leads(discovered)
    if dup_skipped:
        logger.info("Skipped %d near-duplicate Google listing(s) in discovery", dup_skipped)
    if limit and len(discovered) > limit:
        discovered = discovered[:limit]

    raw_path = settings.raw_dir / f"{market_key}_{category_key}_{date.today().isoformat()}.jsonl"
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
            "Skipped %d known lead(s) already in %s (use --force-refresh to re-enrich)",
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
            firecrawl = FirecrawlClient(settings)

    enriched: list[EnrichedLead] = []

    def _credits_budget_exceeded() -> bool:
        cap = settings.firecrawl_max_credits_per_run
        if cap <= 0:
            return False
        used = store.run_credits_total(run_id)
        return used >= cap

    def _do_enrich(raw: RawLead) -> EnrichedLead:
        if _credits_budget_exceeded():
            logger.warning(
                "Firecrawl credit cap reached (%d) — skipping enrichment for %s",
                settings.firecrawl_max_credits_per_run,
                raw.business_name,
            )
            lead = EnrichedLead.model_validate(raw.model_dump())
            lead.source_tool = "google_places"
            lead.investigation_status = InvestigationStatus.DISCOVERED
            lead.notes = f"Skipped enrichment: run credit cap ({settings.firecrawl_max_credits_per_run})"
            return apply_baseline_fields(lead, raw)
        if firecrawl:
            return enrich_lead(
                raw, firecrawl, settings, store=store, run_id=run_id, learn_profiles=True
            )
        lead = EnrichedLead.model_validate(raw.model_dump())
        lead.source_tool = "google_places"
        lead.investigation_status = InvestigationStatus.DISCOVERED
        return apply_baseline_fields(lead, raw)

    workers = max(1, settings.enrichment_parallel_workers)
    if workers > 1 and firecrawl and len(raw_leads) > 1:
        logger.info("Parallel enrichment: %d workers for %d leads", workers, len(raw_leads))

        def _worker(raw: RawLead) -> EnrichedLead:
            client = FirecrawlClient(settings)
            return enrich_lead(
                raw, client, settings, store=store, run_id=run_id, learn_profiles=True
            )

        with ThreadPoolExecutor(max_workers=min(workers, len(raw_leads))) as pool:
            futures = {pool.submit(_worker, raw): raw for raw in raw_leads}
            for i, future in enumerate(as_completed(futures), start=1):
                raw = futures[future]
                try:
                    result = future.result()
                    enriched.append(result)
                    logger.info("[%d/%d] %s — done", i, len(raw_leads), raw.business_name)
                except Exception:
                    logger.exception("Enrichment failed for %s", raw.business_name)
        order = {r.place_id: idx for idx, r in enumerate(raw_leads)}
        enriched.sort(key=lambda lead: order.get(lead.place_id, 999))
    else:
        for i, raw in enumerate(raw_leads, start=1):
            logger.info("[%d/%d] %s — enriching", i, len(raw_leads), raw.business_name)
            enriched.append(_do_enrich(raw))

    out_path = settings.output_dir / f"{market_key}_{category_key}_{date.today().isoformat()}.csv"
    export_csv(enriched, out_path)
    logger.info("Wrote %d leads to %s", len(enriched), out_path)

    if campaign_sink is not None:
        campaign_sink.extend(enriched)

    csv_str = str(out_path)
    for lead in enriched:
        if firecrawl and not discover_only:
            store.upsert_enriched(
                lead,
                market_key=market_key,
                category_key=category_key,
                run_id=run_id,
                csv_path=csv_str,
                profile_key=classify_lead(
                    RawLead.model_validate(lead.model_dump())
                ).key,
            )
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

    if sheets_configured(settings) and not skip_sheets:
        try:
            added = export_sheets(enriched, settings)
            logger.info("Google Sheets: %d new row(s) appended", added)
        except Exception:
            logger.exception("Google Sheets export failed")

    return out_path

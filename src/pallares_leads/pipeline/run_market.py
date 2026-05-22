from __future__ import annotations

import logging
from datetime import date
from pathlib import Path

from pallares_leads.discover.places import PlacesClient
from pallares_leads.enrich.contact_extract import (
    exterior_signals,
    merge_page_contacts,
    property_manager_clues,
)
from pallares_leads.enrich.firecrawl_client import FirecrawlClient
from pallares_leads.pipeline.dedupe import dedupe_by_place_id
from pallares_leads.pipeline.export_csv import export_csv
from pallares_leads.resolve.confidence import score_confidence
from pallares_leads.resolve.contact_hierarchy import contact_to_fields, pick_best_contact
from pallares_leads.schemas import EnrichedLead, InvestigationStatus, RawLead
from pallares_leads.settings import Settings
from pallares_leads.utils.normalize import slugify
from pallares_leads.utils.snapshots import append_jsonl, write_snapshot

logger = logging.getLogger(__name__)


def enrich_lead(
    raw: RawLead,
    firecrawl: FirecrawlClient | None,
    settings: Settings,
) -> EnrichedLead:
    enriched = EnrichedLead.model_validate(raw.model_dump())
    evidence: list[str] = []
    pages: list[tuple[str, str]] = []
    combined_markdown = ""
    best = None

    if raw.website and firecrawl:
        pages = firecrawl.scrape_site(raw.website)
        for url, md in pages:
            evidence.append(url)
            combined_markdown += md + "\n"
            snap_path = (
                settings.snapshots_dir
                / slugify(raw.market_key)
                / slugify(raw.property_type)
                / f"{slugify(raw.business_name)}.md"
            )
            write_snapshot(snap_path, f"# Source: {url}\n\n{md}")

        contacts = merge_page_contacts(pages)
        best = pick_best_contact(contacts)
        for key, value in contact_to_fields(best).items():
            setattr(enriched, key, value)

        clue = property_manager_clues(combined_markdown)
        if clue:
            enriched.property_manager_or_ownership_clue = clue
            enriched.management_source_url = pages[0][0] if pages else raw.website

        enriched.exterior_cleaning_need_signals = exterior_signals(
            combined_markdown, raw.property_type
        )
        enriched.evidence_urls = evidence
        enriched.investigation_status = InvestigationStatus.ENRICHED
    elif not raw.website:
        enriched.notes = "No website on Google listing"
        enriched.investigation_status = InvestigationStatus.NEEDS_MANUAL
    else:
        enriched.investigation_status = InvestigationStatus.DISCOVERED

    if raw.main_phone and enriched.best_contact_phone == "Not found":
        enriched.best_contact_phone = raw.main_phone
        enriched.best_contact_type = "google places phone"
        enriched.contact_source_url = raw.google_maps_url or "Not found"

    enriched.confidence = score_confidence(enriched, best, pages_scraped=len(pages))
    enriched.why_this_is_a_good_fit = (
        f"{raw.lead_category} in {raw.city} — exterior-facing commercial site"
    )
    return enriched


def run_market_category(
    *,
    settings: Settings,
    market_key: str,
    city: str,
    state: str,
    category_key: str,
    category_label: str,
    property_type: str,
    queries: list[str],
    discover_only: bool = False,
    dry_run: bool = False,
) -> Path | None:
    if dry_run:
        for q in queries:
            logger.info("[dry-run] Would search: %r in %s, %s", q, city, state)
        return None

    places = PlacesClient(settings)
    raw_leads = places.discover_category(
        market_key=market_key,
        city=city,
        state=state,
        property_type=property_type,
        lead_category=category_label,
        queries=queries,
    )
    raw_leads = dedupe_by_place_id(raw_leads)

    raw_path = settings.raw_dir / f"{market_key}_{category_key}_{date.today().isoformat()}.jsonl"
    for lead in raw_leads:
        append_jsonl(raw_path, lead.model_dump(mode="json"))

    firecrawl = None if discover_only else FirecrawlClient(settings)
    enriched: list[EnrichedLead] = []
    for raw in raw_leads:
        if discover_only:
            enriched.append(EnrichedLead.model_validate(raw.model_dump()))
        else:
            enriched.append(enrich_lead(raw, firecrawl, settings))

    out_path = settings.output_dir / f"{market_key}_{category_key}_{date.today().isoformat()}.csv"
    export_csv(enriched, out_path)
    logger.info("Wrote %d leads to %s", len(enriched), out_path)
    return out_path

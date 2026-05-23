"""Enrichment pipeline context and stage ordering."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from pallares_leads.enrich.contact_requirements import EnrichmentRules
from pallares_leads.enrich.google_gaps import GoogleGaps
from pallares_leads.enrich.lead_profile import EnrichmentPlaybook, LeadProfile
from pallares_leads.enrich.schema import LeadInvestigationResult
from pallares_leads.schemas import EnrichedLead, RawLead

if TYPE_CHECKING:
    from pallares_leads.db.store import LeadStore
    from pallares_leads.enrich.firecrawl_client import FirecrawlClient
    from pallares_leads.eval.trace import LeadEvalTrace
    from pallares_leads.settings import Settings

STAGE_ORDER: tuple[str, ...] = (
    "profile_fast_path",
    "gaps",
    "search",
    "map",
    "scrape_json",
    "markdown",
    "search_contact",
    "agent_gate",
    "agent",
    "pdf",
    "gateway",
    "final",
)


@dataclass
class EnrichmentContext:
    """Mutable state passed through enrichment stages."""

    raw: RawLead
    enriched: EnrichedLead
    settings: Settings
    firecrawl: FirecrawlClient | None = None
    store: LeadStore | None = None
    trace: LeadEvalTrace | None = None
    run_id: str | None = None
    learn_profiles: bool = True
    profile: LeadProfile | None = None
    playbook: EnrichmentPlaybook | None = None
    tier_rules: EnrichmentRules | None = None
    gaps: GoogleGaps | None = None
    work_raw: RawLead | None = None
    investigation: LeadInvestigationResult | None = None
    agent_ran: bool = False
    used_fast_path: bool = False
    pages_scraped: int = 0
    credits_total: int = 0
    completed_stages: list[str] = field(default_factory=list)

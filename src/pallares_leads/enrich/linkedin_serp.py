"""LinkedIn contact discovery via search-engine snippets only — never scrape linkedin.com."""

from __future__ import annotations

import logging
import re

from pallares_leads.enrich.search_templates import render_search_template
from pallares_leads.schemas import LeadFact, RawLead, SiteContact

logger = logging.getLogger(__name__)

# "Jane Doe - Property Manager - ABC Management" or "Jane Doe – Title – Company"
_LINKEDIN_TITLE = re.compile(
    r"^(.+?)\s*[-–—]\s*(.+?)\s*[-–—]\s*(.+?)(?:\s*\||$)",
    re.I,
)


def parse_linkedin_serp_results(results: list[dict]) -> list[tuple[str, str, str, str]]:
    """Parse Firecrawl search rows into (name, title, company, source_line)."""
    parsed: list[tuple[str, str, str, str]] = []
    seen: set[str] = set()
    for row in results:
        title = str(row.get("title") or row.get("metadata", {}).get("title") or "")
        url = str(row.get("url") or row.get("metadata", {}).get("sourceURL") or "")
        if "linkedin.com/in/" not in url.casefold():
            continue
        match = _LINKEDIN_TITLE.match(title.strip())
        if not match:
            continue
        name, role, company = (g.strip() for g in match.groups())
        key = name.casefold()
        if key in seen or len(name) < 4:
            continue
        seen.add(key)
        parsed.append((name, role, company, title.strip()))
    return parsed


def linkedin_serp_facts(
    contacts: list[tuple[str, str, str, str]],
    *,
    query: str,
) -> list[LeadFact]:
    facts: list[LeadFact] = []
    for name, role, company, line in contacts:
        facts.append(
            LeadFact(
                fact_kind="person",
                value={"name": name, "title": role, "company": company},
                source_kind="linkedin_serp",
                source_url="",
                method="deterministic_parse",
                quote=line,
                verification="unverified",
            )
        )
    if not facts and query:
        logger.debug("LinkedIn SERP returned no parseable contacts for query=%s", query[:80])
    return facts


def linkedin_serp_site_contacts(
    contacts: list[tuple[str, str, str, str]],
) -> list[SiteContact]:
    rows: list[SiteContact] = []
    for name, role, _company, line in contacts:
        rows.append(
            SiteContact(
                label=role or "LinkedIn profile",
                name=name,
                priority="fallback",
                source_url="",
                verification="unverified",
                quote=line,
            )
        )
    return rows


def build_linkedin_query(raw: RawLead, *, config_dir, company_name: str | None = None) -> str:
    target = company_name or raw.business_name
    return render_search_template(
        "linkedin_person_discovery",
        config_dir=config_dir,
        company_name=target,
        city=raw.city,
        state=raw.state,
    )

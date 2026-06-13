from __future__ import annotations

import logging
import re
from typing import Any
from urllib.parse import urlparse

from pallares_leads.config_loader import MarketConfig
from pallares_leads.db.store import LeadStore
from pallares_leads.enrich.firecrawl_client import FirecrawlClient
from pallares_leads.enrich.lead_profile import management_profile_key
from pallares_leads.settings import Settings

logger = logging.getLogger(__name__)

MANAGER_SEARCH_QUERIES = (
    "{city} {state} commercial property management company",
    "{city} property management portfolio manager contact",
    "IREM member property management {city} {state}",
)


def _domain_from_url(url: str) -> str:
    parsed = urlparse(url if "://" in url else f"https://{url}")
    host = (parsed.netloc or parsed.path).lower()
    return host.removeprefix("www.")


def _normalize_company_name(name: str) -> str:
    cleaned = re.sub(r"\s+", " ", name.strip())
    return cleaned[:120]


def harvest_management_directory(
    *,
    settings: Settings,
    market_key: str,
    market: MarketConfig,
    store: LeadStore,
    firecrawl: FirecrawlClient,
    limit: int = 15,
) -> int:
    """Search and scrape property-management company sites into mgmt: playbooks."""
    from pallares_leads.config_loader import load_sources

    city = market["city"]
    state = market["state"]
    harvested = 0
    seen_domains: set[str] = set()

    sources_cfg = load_sources(settings.config_dir)
    association_dirs = sources_cfg.get("association_directories") or []
    for entry in association_dirs:
        if not isinstance(entry, dict):
            continue
        region = str(entry.get("region") or "national")
        if region not in ("national", market_key, market.get("region", "")):
            continue
        url = str(entry.get("url") or "")
        if not url:
            continue
        pages = firecrawl.scrape_site(url, max_pages=2)
        combined = "\n".join(md for _, md in pages)
        if not combined.strip():
            continue
        domain = _domain_from_url(url)
        if domain in seen_domains:
            continue
        seen_domains.add(domain)
        company_name = _normalize_company_name(str(entry.get("name") or domain))
        playbook = {
            "contact_role_label": "Property Manager",
            "typical_source_tool": "association_directory",
            "skip_firecrawl": False,
            "company_name": company_name,
            "company_url": url,
            "market_key": market_key,
            "directory_source": entry.get("name") or domain,
        }
        mgmt_key = management_profile_key(url) or f"mgmt:{domain}"
        store.record_profile_outcome(
            mgmt_key,
            property_type="mgmt",
            site_kind="company",
            brand=domain,
            playbook_update=playbook,
            place_id=f"mgmt:{domain}",
            increment_success=True,
        )
        harvested += 1
        if harvested >= limit:
            return harvested

    for template in MANAGER_SEARCH_QUERIES:
        query = template.format(city=city, state=state)
        results = firecrawl.search_web(query, limit=5)
        for item in results:
            url = str(item.get("url") or "")
            if not url:
                continue
            domain = _domain_from_url(url)
            if not domain or domain in seen_domains:
                continue
            seen_domains.add(domain)

            pages = firecrawl.scrape_site(url, max_pages=2)
            if not pages:
                continue

            combined = "\n".join(md for _, md in pages)
            company_name = _normalize_company_name(
                str(item.get("title") or domain.split(".")[0].replace("-", " ").title())
            )
            phone_match = re.search(
                r"(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}",
                combined,
            )
            phone = phone_match.group(0).strip() if phone_match else ""

            managers: list[dict[str, str]] = []
            for line in combined.splitlines():
                lower = line.lower()
                if any(
                    role in lower
                    for role in ("portfolio", "property manager", "president", "principal")
                ):
                    name_match = re.match(r"^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})", line.strip())
                    if name_match:
                        managers.append({"name": name_match.group(1), "role": "property_manager"})

            playbook: dict[str, Any] = {
                "contact_role_label": "Property Manager",
                "typical_source_tool": "mgmt_directory_harvest",
                "skip_firecrawl": True,
                "trust_google_phone": bool(phone),
                "company_name": company_name,
                "company_url": url,
                "contact_phone": phone,
                "managers": managers[:5],
                "market_key": market_key,
            }
            mgmt_key = management_profile_key(url) or f"mgmt:{domain}"
            store.record_profile_outcome(
                mgmt_key,
                property_type="mgmt",
                site_kind="company",
                brand=domain,
                playbook_update=playbook,
                place_id=f"mgmt:{domain}",
                increment_success=bool(phone or managers),
            )
            harvested += 1
            logger.info("Harvested mgmt profile %s (%s)", mgmt_key, company_name)
            if harvested >= limit:
                return harvested

    return harvested

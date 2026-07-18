from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

from pallares_leads.config_loader import MarketConfig, load_markets
from pallares_leads.db.store import LeadStore
from pallares_leads.discover.places import PlacesClient
from pallares_leads.enrich.firecrawl_client import FirecrawlClient
from pallares_leads.enrich.lead_profile import management_profile_key
from pallares_leads.schemas import EnrichedLead, InvestigationStatus, RawLead
from pallares_leads.settings import Settings
from pallares_leads.utils.normalize import nfkc

logger = logging.getLogger(__name__)

MANAGER_SEARCH_QUERIES = (
    "{city} {state} commercial property management company",
    "{city} property management portfolio manager contact",
    "IREM member property management {city} {state}",
)

PORTFOLIO_PATH_HINTS = ("/properties", "/portfolio", "/our-properties", "/listings")


@dataclass
class PortfolioProperty:
    name: str = ""
    address: str = ""
    city: str = ""
    source_url: str = ""


@dataclass
class PortfolioExpansion:
    mgmt_key: str
    company_name: str = ""
    company_url: str = ""
    contact_phone: str = ""
    properties: list[PortfolioProperty] = field(default_factory=list)


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

            portfolio = scrape_mgmt_portfolio(firecrawl, url)
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
                "portfolio_addresses": [
                    {"name": p.name, "address": p.address, "city": p.city, "url": p.source_url}
                    for p in portfolio[:40]
                ],
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
            logger.info(
                "Harvested mgmt profile %s (%s) — %d portfolio lot(s)",
                mgmt_key,
                company_name,
                len(portfolio),
            )
            if harvested >= limit:
                return harvested

    return harvested


def scrape_mgmt_portfolio(
    firecrawl: FirecrawlClient,
    company_url: str,
    *,
    max_pages: int = 6,
) -> list[PortfolioProperty]:
    """Map /properties|/portfolio pages and extract address-like property rows."""
    if not company_url:
        return []
    mapped = firecrawl.map_contact_urls(company_url, limit=30, property_type="property_manager")
    targets = [company_url]
    for url in mapped:
        lower = url.lower()
        if any(hint in lower for hint in PORTFOLIO_PATH_HINTS):
            targets.append(url)
    targets = list(dict.fromkeys(targets))[:max_pages]

    pages = firecrawl.batch_scrape_urls(targets) or firecrawl.scrape_site(
        company_url, max_pages=max_pages
    )
    properties: list[PortfolioProperty] = []
    seen: set[str] = set()
    address_re = re.compile(
        r"\b(\d{1,5}\s+[A-Z][A-Za-z0-9.'\- ]{2,40}(?:St|Street|Ave|Avenue|Blvd|Road|Rd|Dr|Drive|Way|Ln|Lane)\.?)"
        r"(?:,\s*([A-Z][A-Za-z .'|-]{2,40}))?",
        re.I,
    )
    for page_url, markdown in pages:
        for match in address_re.finditer(markdown or ""):
            street = nfkc(match.group(1))
            city = nfkc(match.group(2) or "")
            key = f"{street.casefold()}|{city.casefold()}"
            if key in seen:
                continue
            seen.add(key)
            # Prefer a nearby heading line as the property name.
            start = max(0, match.start() - 120)
            window = (markdown or "")[start : match.start()]
            name_line = ""
            for line in reversed(window.splitlines()):
                cleaned = nfkc(line.lstrip("#*- ").strip())
                if 3 <= len(cleaned) <= 80 and not address_re.search(cleaned):
                    name_line = cleaned
                    break
            properties.append(
                PortfolioProperty(
                    name=name_line,
                    address=street,
                    city=city,
                    source_url=page_url,
                )
            )
    return properties


def expand_portfolio_from_profile(
    *,
    settings: Settings,
    store: LeadStore,
    firecrawl: FirecrawlClient,
    mgmt_key: str,
    market_key: str,
    limit: int = 25,
) -> PortfolioExpansion:
    """Load a mgmt playbook, scrape portfolio, and seed Places-ready rows with PM phone/clue."""
    playbook = store.get_playbook(mgmt_key) or {}
    company_url = str(playbook.get("company_url") or "")
    company_name = nfkc(str(playbook.get("company_name") or mgmt_key))
    phone = str(playbook.get("contact_phone") or "")
    expansion = PortfolioExpansion(
        mgmt_key=mgmt_key,
        company_name=company_name,
        company_url=company_url,
        contact_phone=phone,
    )
    if not company_url:
        logger.warning("No company_url on playbook %s — cannot expand portfolio", mgmt_key)
        return expansion

    markets = load_markets(settings.config_dir)
    market = markets.get(market_key)
    if market is None:
        logger.warning("Unknown market %s — cannot expand portfolio", market_key)
        return expansion

    properties = scrape_mgmt_portfolio(firecrawl, company_url)
    expansion.properties = properties[:limit]

    playbook = {
        **playbook,
        "portfolio_addresses": [
            {"name": p.name, "address": p.address, "city": p.city, "url": p.source_url}
            for p in expansion.properties
        ],
    }
    store.record_profile_outcome(
        mgmt_key,
        property_type="mgmt",
        site_kind="company",
        brand=mgmt_key.removeprefix("mgmt:"),
        playbook_update=playbook,
        place_id=f"mgmt:{mgmt_key}",
        increment_success=bool(expansion.properties),
    )

    places = PlacesClient(settings, store=store, run_id=f"expand-{mgmt_key}")
    seeded = 0
    run_id = f"expand-{mgmt_key}"
    for prop in expansion.properties:
        query = f"{prop.name or company_name} {prop.address} {prop.city}".strip()
        if not query:
            continue
        try:
            payload = places.search_text(query, market=market)
        except Exception as exc:
            logger.debug("Places seed failed for %s: %s", query, exc)
            continue

        raw: RawLead | None = None
        for place in (payload.get("places") or [])[:1]:
            raw = places.place_to_raw_lead(
                place,
                property_type="strip_mall",
                lead_category="Strip Mall / Retail Plaza",
                discovery_query=query,
                market_key=market_key,
                fallback_city=market["city"],
                fallback_state=market["state"],
            )
            if raw:
                break
        if raw is None:
            continue
        if phone and not raw.main_phone:
            raw.main_phone = phone
        store.touch_discovered(
            raw,
            market_key=market_key,
            category_key="strip_mall",
            run_id=run_id,
        )
        stub = EnrichedLead.model_validate(raw.model_dump())
        stub.property_manager_or_ownership_clue = company_name
        stub.best_contact_phone = phone or stub.best_contact_phone
        stub.best_contact_role = "Property Manager"
        stub.investigation_status = InvestigationStatus.DISCOVERED
        stub.notes = f"portfolio expand from {mgmt_key}"
        store.upsert_enriched(
            stub,
            market_key=market_key,
            category_key="strip_mall",
            run_id=run_id,
            mgmt_profile_key=mgmt_key,
            profile_key=mgmt_key,
        )
        seeded += 1

    logger.info(
        "Portfolio expand %s: %d properties, %d seeded",
        mgmt_key,
        len(expansion.properties),
        seeded,
    )
    return expansion

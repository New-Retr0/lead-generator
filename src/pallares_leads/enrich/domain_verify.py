from __future__ import annotations

import logging
from typing import TYPE_CHECKING

import httpx

from pallares_leads.enrich.website_discover import is_skipped_domain
from pallares_leads.schemas import EnrichedLead
from pallares_leads.utils.http_retry import request_with_retry
from pallares_leads.utils.safe_url import is_private_or_local_host, is_safe_http_url

if TYPE_CHECKING:
    from pallares_leads.db.store import LeadStore

logger = logging.getLogger(__name__)

_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml",
}

# In-process fallback when no store is available
_memory_cache: dict[str, tuple[bool, float]] = {}
_MEMORY_TTL_S = 86400


def website_hostname(url: str) -> str | None:
    if not url:
        return None
    from urllib.parse import urlparse

    normalized = url if "://" in url else f"https://{url}"
    return urlparse(normalized).hostname


def dns_resolves(hostname: str) -> bool:
    import socket

    try:
        socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
        return True
    except socket.gaierror:
        return False


def _cache_get(hostname: str, store: LeadStore | None) -> bool | None:
    if store is not None:
        return store.get_domain_cache(hostname)
    import time

    entry = _memory_cache.get(hostname.lower())
    if entry is None:
        return None
    ok, ts = entry
    if time.time() - ts > _MEMORY_TTL_S:
        return None
    return ok


def _cache_set(hostname: str, is_valid: bool, store: LeadStore | None) -> None:
    if store is not None:
        store.set_domain_cache(hostname, is_valid)
        return
    import time

    _memory_cache[hostname.lower()] = (is_valid, time.time())


def verify_website_url(
    url: str,
    *,
    timeout: float = 12.0,
    store: LeadStore | None = None,
) -> bool:
    """True when the domain resolves and returns HTTP success (real site, not NXDOMAIN)."""
    if not url or is_skipped_domain(url):
        return False

    base = url.split("#")[0].rstrip("/")
    host = website_hostname(base)
    if not host:
        return False

    cached = _cache_get(host, store)
    if cached is not None:
        return cached

    if not dns_resolves(host):
        logger.info("Website rejected (DNS): %s", base)
        _cache_set(host, False, store)
        return False

    if is_private_or_local_host(host):
        logger.info("Website rejected (private/local host): %s", base)
        _cache_set(host, False, store)
        return False

    if not is_safe_http_url(base):
        logger.info("Website rejected (unsafe URL): %s", base)
        _cache_set(host, False, store)
        return False

    try:
        with httpx.Client(
            timeout=timeout, follow_redirects=True, headers=_BROWSER_HEADERS
        ) as client:
            response = request_with_retry(
                lambda: client.head(base),
                label=f"HEAD {host}",
            )
            if response.status_code in (405, 501) or response.status_code >= 400:
                response = request_with_retry(
                    lambda: client.get(base),
                    label=f"GET {host}",
                )
            if response.status_code == 403:
                logger.info("Website accepted (DNS ok, HTTP 403 bot-block): %s", base)
                _cache_set(host, True, store)
                return True
            if response.status_code >= 400:
                logger.info("Website rejected (HTTP %s): %s", response.status_code, base)
                _cache_set(host, False, store)
                return False
            _cache_set(host, True, store)
            return True
    except httpx.HTTPError as exc:
        logger.info("Website rejected (unreachable): %s — %s", base, exc)
        _cache_set(host, False, store)
        return False


def pick_verified_website_url(
    urls: list[str],
    business_name: str = "",
    *,
    store: LeadStore | None = None,
) -> str | None:
    """Score candidates, return the first that passes DNS + HTTP verification."""
    if not urls:
        return None

    slug = "".join(ch for ch in business_name.lower() if ch.isalnum())
    scored: list[tuple[int, str]] = []

    for url in urls:
        if not url or is_skipped_domain(url):
            continue
        base = url.split("#")[0].rstrip("/")
        lower = base.lower().replace("-", "")
        score = 0
        if slug and slug[:10] in lower:
            score += 5
        if any(tld in lower for tld in (".com", ".net", ".org")):
            score += 2
        if ".shop" in lower:
            score += 1
        if "contact" in lower:
            score += 1
        if "mapquest" in lower or "yellowpages" in lower:
            score -= 4
        scored.append((score, base))

    if not scored:
        return None

    scored.sort(key=lambda item: item[0], reverse=True)
    seen: set[str] = set()
    for _, candidate in scored:
        if candidate in seen:
            continue
        seen.add(candidate)
        if verify_website_url(candidate, store=store):
            logger.info("Verified website: %s", candidate)
            return candidate

    logger.info("No verified website among %d candidate(s) for %r", len(scored), business_name)
    return None


def scrub_unverified_website(
    enriched: EnrichedLead,
    *,
    store: LeadStore | None = None,
    verify_evidence: bool = False,
) -> EnrichedLead:
    """Drop dead domains. Cached lookups avoid repeat HTTP on export."""
    website_ok = bool(enriched.website) and verify_website_url(enriched.website, store=store)

    if enriched.website and not website_ok:
        enriched.website = None
        if not enriched.notes:
            enriched.notes = "Website failed domain verification — needs manual lookup"
        elif "failed domain verification" not in enriched.notes:
            enriched.notes = f"{enriched.notes}; website failed verification"
    elif website_ok:
        enriched.notes = (
            enriched.notes.replace("Website failed domain verification — needs manual lookup", "")
            .replace("; website failed verification", "")
            .strip(" ;")
        )

    if verify_evidence:
        enriched.evidence_urls = [
            url
            for url in enriched.evidence_urls
            if verify_website_url(url.split("#")[0], store=store)
        ]

        if enriched.contact_source_url and enriched.contact_source_url.startswith("http"):
            if not verify_website_url(enriched.contact_source_url, store=store):
                enriched.contact_source_url = (
                    enriched.evidence_urls[0]
                    if enriched.evidence_urls
                    else enriched.contact_source_url
                )

    return enriched

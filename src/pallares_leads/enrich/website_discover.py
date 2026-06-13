from __future__ import annotations

from pallares_leads.schemas import NOT_FOUND, EnrichedLead

SKIP_DOMAINS = (
    "google.com",
    "goo.gl",
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "yelp.com",
    "tripadvisor.com",
    "bing.com",
    "wikipedia.org",
    "mapquest.com",
    "yellowpages.com",
    "manta.com",
    "bizapedia.com",
)


def is_skipped_domain(url: str) -> bool:
    lower = url.lower()
    return any(domain in lower for domain in SKIP_DOMAINS)


def _slugify_name(business_name: str) -> str:
    return "".join(ch for ch in business_name.lower() if ch.isalnum())


def candidate_website_urls(business_name: str) -> list[str]:
    slug = _slugify_name(business_name)
    if not slug:
        return []
    return [
        f"https://{slug}.shop",
        f"https://{slug}.shop/#contact",
        f"https://www.{slug}.com",
        f"https://{slug}.com",
    ]


def pick_website_url(urls: list[str], business_name: str = "") -> str | None:
    """Pick the best official-site URL from a list of candidates."""
    slug = _slugify_name(business_name)
    scored: list[tuple[int, str]] = []

    for url in urls:
        if not url or is_skipped_domain(url):
            continue
        lower = url.lower().replace("-", "")
        score = 0
        if slug and slug[:10] in lower:
            score += 5
        if ".shop" in lower:
            score += 3
        if "mapquest" in lower or "yellowpages" in lower or "manta.com" in lower:
            score -= 4
        if any(tld in lower for tld in (".com", ".net", ".org")):
            score += 1
        if "contact" in lower:
            score += 1
        scored.append((score, url.split("#")[0] if "#" in url else url))

    if not scored:
        return None

    scored.sort(key=lambda item: item[0], reverse=True)
    return scored[0][1]


def website_link_url(lead: EnrichedLead) -> str:
    """Best clickable website URL for sales — prefers contact page when known."""
    base = (lead.website or "").rstrip("/")
    if not base:
        return ""

    if lead.contact_source_url not in ("", NOT_FOUND) and lead.contact_source_url.startswith(
        "http"
    ):
        return lead.contact_source_url

    for url in lead.evidence_urls:
        if url and "contact" in url.lower():
            return url

    if "#" not in base:
        return f"{base}#contact"
    return base


def primary_evidence_url(lead: EnrichedLead) -> str:
    """Best evidence / contact page URL for sales follow-up."""
    if lead.contact_source_url not in ("", NOT_FOUND) and not is_skipped_domain(
        lead.contact_source_url
    ):
        return lead.contact_source_url

    for url in lead.evidence_urls:
        if url and not is_skipped_domain(url):
            return url

    if lead.website:
        base = lead.website.rstrip("/")
        if "#contact" in base.lower() or base.lower().endswith("/contact"):
            return base
        return f"{base}#contact" if "#" not in base else base

    return ""

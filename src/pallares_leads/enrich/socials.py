"""Deterministic social-profile link extraction from fetched page markdown.

Regex-only — every social fact is a URL that literally appeared on a fetched
page, so it is verified at birth with the page as its source.
"""

from __future__ import annotations

import re
from urllib.parse import urlparse

from pallares_leads.schemas import LeadFact

# platform -> (regex over markdown, path-segments to keep when normalizing)
_SOCIAL_PATTERNS: dict[str, re.Pattern[str]] = {
    "facebook": re.compile(r"https?://(?:www\.)?facebook\.com/[A-Za-z0-9_.\-/%]+", re.I),
    "instagram": re.compile(r"https?://(?:www\.)?instagram\.com/[A-Za-z0-9_.\-/%]+", re.I),
    "tiktok": re.compile(r"https?://(?:www\.)?tiktok\.com/@[A-Za-z0-9_.\-]+", re.I),
    "youtube": re.compile(
        r"https?://(?:www\.)?youtube\.com/(?:@[A-Za-z0-9_.\-]+|channel/[A-Za-z0-9_\-]+|c/[A-Za-z0-9_.\-]+)",
        re.I,
    ),
    "linkedin": re.compile(
        r"https?://(?:www\.)?linkedin\.com/(?:company|in)/[A-Za-z0-9_.\-%]+", re.I
    ),
    "x": re.compile(r"https?://(?:www\.)?(?:twitter|x)\.com/[A-Za-z0-9_]+", re.I),
    "yelp": re.compile(r"https?://(?:www\.)?yelp\.com/biz/[A-Za-z0-9_\-%]+", re.I),
}

_SKIP_SEGMENTS = frozenset(
    {
        "sharer",
        "share",
        "intent",
        "plugins",
        "dialog",
        "login",
        "signup",
        "hashtag",
        "search",
        "policies",
        "legal",
        "help",
        "privacy",
        "tr",
    }
)


def _normalize(url: str) -> str | None:
    parsed = urlparse(url)
    path = parsed.path.rstrip("/")
    if not path or path == "/":
        return None
    first_segment = path.lstrip("/").split("/")[0].casefold()
    if first_segment in _SKIP_SEGMENTS:
        return None
    host = parsed.netloc.casefold().removeprefix("www.")
    return f"https://{host}{path}"


def extract_social_links(markdown: str) -> dict[str, list[str]]:
    """Platform -> deduped normalized profile URLs found in the text."""
    found: dict[str, list[str]] = {}
    for platform, pattern in _SOCIAL_PATTERNS.items():
        urls: list[str] = []
        for match in pattern.finditer(markdown):
            normalized = _normalize(match.group())
            if normalized and normalized not in urls:
                urls.append(normalized)
        if urls:
            found[platform] = urls
    return found


def social_facts_from_pages(pages: dict[str, str]) -> list[LeadFact]:
    """Scan fetched markdown pages (url -> markdown) for social profile links."""
    facts: list[LeadFact] = []
    seen: set[str] = set()
    for page_url, markdown in pages.items():
        if not markdown:
            continue
        for platform, urls in extract_social_links(markdown).items():
            for url in urls:
                if url in seen:
                    continue
                seen.add(url)
                facts.append(
                    LeadFact(
                        fact_kind="social",
                        value={"platform": platform, "url": url},
                        source_kind="website",
                        source_url=page_url,
                        method="deterministic_parse",
                        quote=url,
                        verification="verified",
                    )
                )
    return facts

"""Insurance-evidence scan for vendor leads.

Scans markdown already fetched this session (zero extra credits) for
insurance keywords from the category's `insurance_keywords` config and
records each hit as a verified `insurance_mention` fact with the literal
page snippet as its provenance quote.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from pallares_leads.schemas import LeadFact

_MAX_FACTS = 2
_SNIPPET_RADIUS = 120


def insurance_facts_from_pages(
    pages: Mapping[str, str],
    keywords: Sequence[str],
) -> list[LeadFact]:
    """Return up to two insurance_mention facts grounded in fetched markdown."""
    if not keywords:
        return []
    facts: list[LeadFact] = []
    seen_urls: set[str] = set()
    ordered = sorted(keywords, key=len, reverse=True)
    for url, markdown in pages.items():
        if url in seen_urls or not markdown:
            continue
        lowered = markdown.casefold()
        for keyword in ordered:
            idx = lowered.find(keyword.casefold())
            if idx == -1:
                continue
            start = max(0, idx - _SNIPPET_RADIUS)
            end = min(len(markdown), idx + len(keyword) + _SNIPPET_RADIUS)
            snippet = " ".join(markdown[start:end].split())
            facts.append(
                LeadFact(
                    fact_kind="insurance_mention",
                    value={"keyword": keyword},
                    source_kind="company_website",
                    source_url=url,
                    method="keyword_scan",
                    quote=snippet,
                    verification="verified",
                )
            )
            seen_urls.add(url)
            break
        if len(facts) >= _MAX_FACTS:
            break
    return facts

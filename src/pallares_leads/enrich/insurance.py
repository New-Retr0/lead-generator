"""Insurance-evidence scan for vendor leads.

Scans markdown already fetched this session (zero extra credits) for
insurance keywords from the category's `insurance_keywords` config and
records each hit as a verified `insurance_mention` fact with the literal
page snippet as its provenance quote.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING

from pallares_leads.schemas import LeadFact

if TYPE_CHECKING:
    from pallares_leads.db.store import LeadStore
    from pallares_leads.settings import Settings

logger = logging.getLogger(__name__)

_MAX_FACTS = 2
_SNIPPET_RADIUS = 120
_MAX_NEED_SIGNAL_CHARS = 6000


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


def need_signals_ai_fallback(
    pages: Mapping[str, str],
    *,
    property_type: str,
    business_name: str,
    city: str,
    state: str,
    settings: Settings,
    store: LeadStore | None = None,
    run_id: str | None = None,
    place_id: str | None = None,
    stage: str = "scrape",
) -> str:
    """Classify exterior-cleaning need signals when regex/keyword scans find nothing."""
    from pallares_leads.enrich.ai_gateway_client import gateway_chat_completion, gateway_configured

    if not settings.ai_need_signal_fallback or not pages:
        return ""
    if not gateway_configured(settings):
        return ""

    combined_parts: list[str] = []
    for url, markdown in pages.items():
        if markdown.strip():
            combined_parts.append(f"--- {url} ---\n{markdown.strip()}")
    combined = "\n\n".join(combined_parts)
    if not combined.strip():
        return ""

    combined = combined[:_MAX_NEED_SIGNAL_CHARS]
    user = (
        f"Business: {business_name}\n"
        f"City: {city}, {state}\n"
        f"Property type: {property_type}\n\n"
        f"Page content:\n{combined}\n\n"
        "List exterior pressure-washing need signals literally supported by the text "
        "(dirty sidewalks, storefront glass, parking lots, dumpster pads, maintenance RFPs, "
        "property manager clues). Return JSON: "
        '{"signals": "comma-separated short phrases or empty string", "confidence": 0.0-1.0}'
    )
    completion = gateway_chat_completion(
        settings,
        system_prompt=(
            "You classify commercial property exterior maintenance needs for pressure washing. "
            "Only include signals explicitly supported by the page text."
        ),
        user_content=user,
        operation="need_signals",
        stage=stage,
        temperature=0,
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "need_signals",
                "schema": {
                    "type": "object",
                    "properties": {
                        "signals": {"type": "string"},
                        "confidence": {"type": "number"},
                    },
                    "required": ["signals", "confidence"],
                    "additionalProperties": False,
                },
                "strict": True,
            },
        },
        store=store,
        run_id=run_id,
        place_id=place_id,
    )
    if not completion or not completion.content:
        return ""
    try:
        parsed = json.loads(completion.content)
    except json.JSONDecodeError:
        logger.warning("need_signals fallback returned invalid JSON")
        return ""
    signals = str(parsed.get("signals") or "").strip()
    confidence = float(parsed.get("confidence") or 0.0)
    if confidence < 0.5 or not signals:
        return ""
    return signals

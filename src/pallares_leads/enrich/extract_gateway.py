"""Contact + sales copy extraction via AI Gateway (replaces Firecrawl JSON mode)."""

from __future__ import annotations

import hashlib
import json
import logging
from typing import TYPE_CHECKING

from pallares_leads.enrich.ai_gateway_client import gateway_chat_completion, gateway_configured
from pallares_leads.enrich.schema import LEAD_INVESTIGATION_SCHEMA, LeadInvestigationResult
from pallares_leads.enrich.verify import ground_investigation
from pallares_leads.schemas import RawLead

if TYPE_CHECKING:
    from pallares_leads.db.store import LeadStore
    from pallares_leads.settings import Settings

logger = logging.getLogger(__name__)

_EXTRACT_SYSTEM = (
    "Extract commercial property contacts and Pallares exterior-cleaning sales angles "
    "from the page markdown. Return only facts literally present in the text. "
    "Prefer facilities, maintenance, property manager, owner, GM, and leasing contacts."
)


def _markdown_hash(markdown: str) -> str:
    return hashlib.sha256(markdown.encode("utf-8")).hexdigest()


def extract_contacts(
    markdown: str,
    raw: RawLead,
    settings: Settings,
    *,
    source_url: str = "",
    store: LeadStore | None = None,
    run_id: str | None = None,
    place_id: str | None = None,
    request_id: str | None = None,
    stage: str | None = None,
) -> LeadInvestigationResult | None:
    """Extract contacts + sales copy from markdown via AI Gateway JSON schema."""
    if not markdown.strip() or not gateway_configured(settings):
        return None

    content_hash = _markdown_hash(markdown)
    if store:
        cached_json = store.get_extraction_cache(
            property_type=raw.property_type,
            markdown_hash=content_hash,
            ttl_days=settings.page_cache_ttl_days,
        )
        if cached_json and isinstance(cached_json, str):
            try:
                parsed = json.loads(cached_json)
                investigation = LeadInvestigationResult.from_api_payload(parsed)
                if investigation:
                    label = source_url or raw.website or ""
                    grounding = ground_investigation(investigation, markdown, source_label=label)
                    return grounding.result
            except json.JSONDecodeError:
                pass

    user = (
        f"Business: {raw.business_name}\n"
        f"City: {raw.city}, {raw.state}\n"
        f"Property type: {raw.property_type}\n\n"
        f"Page markdown:\n{markdown[: settings.ai_gateway_max_context_chars]}"
    )
    result = gateway_chat_completion(
        settings,
        system_prompt=_EXTRACT_SYSTEM,
        user_content=user,
        operation="contact_extract",
        temperature=0,
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "lead_investigation",
                "schema": LEAD_INVESTIGATION_SCHEMA,
                "strict": True,
            },
        },
        store=store,
        run_id=run_id,
        place_id=place_id or raw.place_id,
        request_id=request_id,
        stage=stage,
    )
    if not result or not result.content:
        return None

    try:
        parsed = json.loads(result.content)
    except json.JSONDecodeError:
        logger.warning("Gateway contact_extract returned invalid JSON")
        return None

    investigation = LeadInvestigationResult.from_api_payload(parsed)
    if not investigation:
        return None

    if store:
        store.set_extraction_cache(
            property_type=raw.property_type,
            markdown_hash=content_hash,
            result_json=json.dumps(investigation.model_dump(mode="json")),
        )

    label = source_url or raw.website or ""
    grounding = ground_investigation(investigation, markdown, source_label=label)
    return grounding.result

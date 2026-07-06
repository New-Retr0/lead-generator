from __future__ import annotations

import json
import logging
import re
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel

from pallares_leads.enrich.ai_gateway_client import (
    gateway_chat_completion,
    gateway_configured,
)
from pallares_leads.enrich.contact_requirements import get_enrichment_rules
from pallares_leads.enrich.lead_profile import detect_brand
from pallares_leads.enrich.schema import LeadInvestigationResult
from pallares_leads.schemas import EnrichedLead, RawLead
from pallares_leads.settings import Settings

if TYPE_CHECKING:
    from pallares_leads.db.store import LeadStore
    from pallares_leads.eval.trace import LeadEvalTrace

logger = logging.getLogger(__name__)

GENERIC_COPY_PATTERNS = (
    re.compile(r"high foot traffic", re.I),
    re.compile(r"located near major roads?", re.I),
    re.compile(r"curb appeal", re.I),
    re.compile(r"seasonal cleaning", re.I),
    re.compile(r"drive-thru visibility", re.I),
    re.compile(r"pristine appearance", re.I),
    re.compile(r"top-notch appearance", re.I),
    re.compile(r"clean and inviting", re.I),
    re.compile(r"maintain a (clean|spotless|polished)", re.I),
)

_BROKER_HOOKS = re.compile(
    r"\b(vendor network|managed service|photo.?verified|quality check|recurring program|"
    r"multi.?location|we manage|pallares manages|flat.?rate|net-30)\b",
    re.I,
)
_SERVICE_HOOKS = re.compile(
    r"\b(parking lot|concrete|storefront|facade|canopy|awning|dumpster|drive.?thru|"
    r"pressure wash|oil stain|signage|pump island|lot washing)\b",
    re.I,
)

PROMPT_VERSION = "sales_copy_v1"

SYSTEM_PROMPT = (
    "You write cold-call notes for PALLARES — a national B2B exterior-services broker "
    "(pallares.us). Pallares manages commercial pressure washing from quote through "
    "photo-verified QC and vendor payment; the prospect does NOT hire a random contractor. "
    "Use ONLY facts from the provided research bundle. "
    "Return JSON with why_call (1-2 sentences) and talking_points (3-5 lines starting with •). "
    "Lead with property-specific exterior surfaces (parking lot, storefront, canopy, dumpster "
    "enclosure, drive-through) when the data supports them. Mention managed vendor network, "
    "recurring multi-location programs, or photo-verified QC only when relevant to the property. "
    "Speak to property managers, facilities, or operations — not patients or consumers. "
    "Do not invent traffic counts, tenant names, or landmarks. "
    "If a detail is unknown, omit it rather than guessing."
)


class SalesCopyResult(BaseModel):
    why_call: str = ""
    talking_points: str = ""


def _sales_copy_response_format() -> dict[str, Any]:
    return {
        "type": "json_schema",
        "json_schema": {
            "name": "sales_copy",
            "schema": {
                "type": "object",
                "properties": {
                    "why_call": {"type": "string"},
                    "talking_points": {"type": "string"},
                },
                "required": ["why_call", "talking_points"],
                "additionalProperties": False,
            },
            "strict": False,
        },
    }


def is_generic_copy(
    why_call: str, talking_points: str, *, city: str = "", business_name: str = ""
) -> bool:
    combined = f"{why_call}\n{talking_points}".strip()
    if not combined:
        return False
    if _BROKER_HOOKS.search(combined) or _SERVICE_HOOKS.search(combined):
        return False
    if re.search(
        r"\b[\d,]+(?:\+)?\s*(?:daily\s+)?(cars|adt|sf|spaces|residents)\b",
        combined,
        re.I,
    ):
        return False
    matches = sum(1 for pattern in GENERIC_COPY_PATTERNS if pattern.search(combined))
    if matches >= 1:
        return True
    if city and city.lower() in combined.lower() and not _SERVICE_HOOKS.search(combined):
        return True
    return False


def needs_sales_copy(enriched: EnrichedLead) -> bool:
    why = enriched.why_this_is_a_good_fit.strip()
    points = enriched.sales_talking_points.strip()
    if not why or not points:
        return True
    return is_generic_copy(why, points, city=enriched.city, business_name=enriched.business_name)


def parse_json_from_llm(content: str) -> dict[str, Any] | None:
    text = content.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            try:
                parsed = json.loads(text[start : end + 1])
                return parsed if isinstance(parsed, dict) else None
            except json.JSONDecodeError:
                return None
    return None


def build_research_context(
    enriched: EnrichedLead,
    raw: RawLead,
    investigation: LeadInvestigationResult | None,
    pdf_snippets: list[str],
) -> dict[str, Any]:
    contacts: list[dict[str, str]] = []
    for contact in enriched.site_contacts:
        contacts.append(
            {
                "label": contact.label,
                "name": contact.name,
                "phone": contact.phone,
                "email": contact.email,
                "priority": contact.priority,
            }
        )
    if not contacts and investigation:
        if investigation.contact_name or investigation.contact_phone:
            contacts.append(
                {
                    "label": investigation.contact_role,
                    "name": investigation.contact_name,
                    "phone": investigation.contact_phone,
                    "email": investigation.contact_email,
                    "priority": "best",
                }
            )

    evidence = list(dict.fromkeys(enriched.evidence_urls))
    if investigation and investigation.source_urls:
        for url in investigation.source_urls:
            if url not in evidence:
                evidence.append(url)

    context: dict[str, Any] = {
        "business_name": enriched.business_name,
        "lead_category": enriched.lead_category,
        "property_type": enriched.property_type,
        "city": enriched.city,
        "formatted_address": enriched.formatted_address,
        "main_phone": enriched.main_phone or raw.main_phone or "",
        "website": enriched.website or raw.website or "",
        "google_types": raw.google_types,
        "contacts": contacts,
        "property_manager": enriched.property_manager_or_ownership_clue,
        "exterior_signals": enriched.exterior_cleaning_need_signals,
        "evidence_urls": evidence,
        "pdf_snippets": pdf_snippets,
        "notes": enriched.notes,
    }
    if investigation and investigation.exterior_signals and not context["exterior_signals"]:
        context["exterior_signals"] = investigation.exterior_signals
    return context


def _truncate_context(context: dict[str, Any], max_chars: int) -> dict[str, Any]:
    payload = json.dumps(context, ensure_ascii=False)
    if len(payload) <= max_chars:
        return context

    trimmed = dict(context)
    snippets = trimmed.get("pdf_snippets")
    if isinstance(snippets, list) and snippets:
        first = snippets[0]
        if isinstance(first, str) and len(first) > 1200:
            trimmed["pdf_snippets"] = [first[:1200] + "…"]
    return trimmed


def generate_sales_copy(
    context: dict[str, Any],
    settings: Settings,
    *,
    store: LeadStore | None = None,
    run_id: str | None = None,
    request_id: str | None = None,
    place_id: str | None = None,
) -> SalesCopyResult | None:
    if not gateway_configured(settings):
        return None

    context = _truncate_context(context, settings.ai_gateway_max_context_chars)
    try:
        completion = gateway_chat_completion(
            settings,
            system_prompt=SYSTEM_PROMPT,
            user_content=json.dumps(context, ensure_ascii=False),
            store=store,
            run_id=run_id,
            request_id=request_id,
            place_id=place_id,
            operation="sales_copy",
            response_format=_sales_copy_response_format(),
            prompt_version=PROMPT_VERSION,
            stage="sales_copy",
        )
        if not completion or not completion.content:
            return None
        content = completion.content

        parsed = parse_json_from_llm(content)
        if not parsed:
            return None

        return SalesCopyResult(
            why_call=str(parsed.get("why_call") or "").strip(),
            talking_points=str(parsed.get("talking_points") or "").strip(),
        )
    except (KeyError, IndexError) as exc:
        logger.warning("AI Gateway sales copy error: %s", exc)
        return None


def maybe_enrich_sales_copy(
    enriched: EnrichedLead,
    raw: RawLead,
    investigation: LeadInvestigationResult | None,
    pdf_snippets: list[str],
    settings: Settings,
    *,
    trace: LeadEvalTrace | None = None,
    store: LeadStore | None = None,
    run_id: str | None = None,
    request_id: str | None = None,
) -> EnrichedLead:
    if not gateway_configured(settings):
        if trace:
            trace.record("gateway", ran=False, reason="AI Gateway not configured")
        return enriched

    if enriched.why_this_is_a_good_fit and enriched.sales_talking_points:
        if not is_generic_copy(
            enriched.why_this_is_a_good_fit,
            enriched.sales_talking_points,
            city=enriched.city,
            business_name=enriched.business_name,
        ):
            if trace:
                trace.record(
                    "gateway",
                    ran=False,
                    reason="rich non-generic scrape copy kept",
                )
            return enriched

    if not needs_sales_copy(enriched):
        if trace:
            trace.record("gateway", ran=False, reason="existing copy sufficient")
        return enriched

    context = build_research_context(enriched, raw, investigation, pdf_snippets)
    result = generate_sales_copy(
        context,
        settings,
        store=store,
        run_id=run_id,
        request_id=request_id,
        place_id=enriched.place_id,
    )
    if not result or not (result.why_call or result.talking_points):
        if trace:
            trace.record("gateway", ran=False, reason="Gateway returned empty result")
        return enriched

    if result.why_call:
        enriched.why_this_is_a_good_fit = result.why_call
    if result.talking_points:
        enriched.sales_talking_points = result.talking_points

    rules = get_enrichment_rules(enriched.property_type, settings.config_dir)
    if (
        rules.suggest_recurring
        and detect_brand(enriched.business_name, enriched.website) != "independent"
    ):
        recurring = (
            "• Pallares offers recurring multi-location maintenance programs with bundle pricing"
        )
        if recurring not in enriched.sales_talking_points:
            enriched.sales_talking_points = (
                f"{enriched.sales_talking_points.rstrip()}\n{recurring}".strip()
            )

    if enriched.source_tool and "+ai_gateway_copy" not in enriched.source_tool:
        enriched.source_tool = f"{enriched.source_tool}+ai_gateway_copy"
    elif not enriched.source_tool:
        enriched.source_tool = "google_places+ai_gateway_copy"

    logger.info("  AI Gateway sales copy generated for %s", enriched.business_name)
    if trace:
        trace.record(
            "gateway",
            ran=True,
            reason="generated sales copy",
            credits_est=0,
            outputs={
                "why_call_len": len(result.why_call),
                "talking_points_len": len(result.talking_points),
            },
        )
    return enriched

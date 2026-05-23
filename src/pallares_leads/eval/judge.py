from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, field_validator

from pallares_leads.enrich.contact_requirements import get_enrichment_rules
from pallares_leads.enrich.sales_copy import (
    gateway_chat_completion,
    gateway_configured,
    parse_json_from_llm,
)
from pallares_leads.settings import Settings

logger = logging.getLogger(__name__)

JUDGE_SYSTEM_PROMPT = (
    "You evaluate commercial property lead enrichment for PALLARES exterior cleaning sales "
    "in California's Central Valley. Use enrichment_rules in the payload to judge whether "
    "contacts meet the configured min_contact_bar (form < email < phone < labeled_phone). "
    "A salesperson needs property-specific Why Call and talking points without invented facts. "
    "Judge whether Firecrawl Agent (75 credits) was justified vs cheaper Map/Scrape/Gateway stages. "
    "Return JSON with: contact_quality (1-5), copy_quality (1-5), "
    "agent_necessity (required|avoidable|unnecessary), agent_gate_correct (bool), "
    "sales_ready (bool), contact_rationale, copy_rationale, agent_rationale, "
    "key_gaps (string array), optimization_hint."
)


class LlmJudgeResult(BaseModel):
    contact_quality: int = Field(ge=1, le=5)
    copy_quality: int = Field(ge=1, le=5)
    agent_necessity: str
    agent_gate_correct: bool
    sales_ready: bool
    contact_rationale: str = ""
    copy_rationale: str = ""
    agent_rationale: str = ""
    key_gaps: list[str] = Field(default_factory=list)
    optimization_hint: str = ""

    @field_validator("agent_necessity")
    @classmethod
    def normalize_necessity(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"required", "avoidable", "unnecessary"}:
            return "avoidable"
        return normalized


def build_judge_context(
    report: dict[str, Any],
    *,
    prior_diff: dict[str, Any] | None = None,
    raw_input: dict[str, Any] | None = None,
    config_dir: Path | None = None,
) -> dict[str, Any]:
    stages_summary = [
        {
            "stage": stage.get("stage"),
            "ran": stage.get("ran"),
            "reason": stage.get("reason"),
            "credits_est": stage.get("credits_est"),
            "outputs": stage.get("outputs"),
        }
        for stage in report.get("stages") or []
    ]
    return {
        "business_name": report.get("business_name"),
        "property_type": report.get("property_type"),
        "category": report.get("category"),
        "enrichment_rules": get_enrichment_rules(
            str(report.get("property_type") or ""),
            config_dir,
        ).__dict__,
        "raw_input": raw_input or {},
        "agent_actually_ran": report.get("agent_actually_ran"),
        "agent_gate_reason": report.get("agent_gate_reason"),
        "final_source_tool": report.get("final_source_tool"),
        "export_preview": report.get("export_preview") or {},
        "gaps_vs_ideal": report.get("gaps_vs_ideal") or [],
        "automated_quality": report.get("quality") or {},
        "stages": stages_summary,
        "prior_pipeline_diff": prior_diff or {},
        "credits_est_total": report.get("credits_est_total"),
    }


def judge_lead_report(
    report: dict[str, Any],
    settings: Settings,
    *,
    prior_diff: dict[str, Any] | None = None,
    raw_input: dict[str, Any] | None = None,
    config_dir: Path | None = None,
) -> LlmJudgeResult | None:
    if not gateway_configured(settings):
        logger.debug("LLM judge skipped — AI Gateway not configured")
        return None

    context = build_judge_context(
        report,
        prior_diff=prior_diff,
        raw_input=raw_input,
        config_dir=config_dir or settings.config_dir,
    )
    try:
        content = gateway_chat_completion(
            settings,
            system_prompt=JUDGE_SYSTEM_PROMPT,
            user_content=json.dumps(context, ensure_ascii=False),
            timeout=90.0,
        )
        if not content:
            return None
        parsed = parse_json_from_llm(content)
        if not parsed:
            return None
        return LlmJudgeResult.model_validate(parsed)
    except (ValueError) as exc:
        logger.warning("LLM judge error: %s", exc)
        return None

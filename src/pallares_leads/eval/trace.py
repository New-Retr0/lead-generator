from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pallares_leads.schemas import EnrichedLead, RawLead


@dataclass
class StageRecord:
    stage: str
    ran: bool
    reason: str = ""
    credits_est: int = 0
    inputs: dict[str, Any] = field(default_factory=dict)
    outputs: dict[str, Any] = field(default_factory=dict)
    quality: dict[str, Any] = field(default_factory=dict)


@dataclass
class LeadEvalReport:
    place_id: str
    business_name: str
    category: str
    property_type: str
    run_id: str
    timestamp: str
    stages: list[StageRecord] = field(default_factory=list)
    tier2_gate_reason: str = ""
    final_source_tool: str = ""
    export_preview: dict[str, Any] = field(default_factory=dict)
    gaps_vs_ideal: list[str] = field(default_factory=list)
    quality: dict[str, Any] = field(default_factory=dict)
    credits_est_total: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "place_id": self.place_id,
            "business_name": self.business_name,
            "category": self.category,
            "property_type": self.property_type,
            "run_id": self.run_id,
            "timestamp": self.timestamp,
            "stages": [
                {
                    "stage": s.stage,
                    "ran": s.ran,
                    "reason": s.reason,
                    "credits_est": s.credits_est,
                    "inputs": s.inputs,
                    "outputs": s.outputs,
                    "quality": s.quality,
                }
                for s in self.stages
            ],
            "tier2_gate_reason": self.tier2_gate_reason,
            "final_source_tool": self.final_source_tool,
            "export_preview": self.export_preview,
            "gaps_vs_ideal": self.gaps_vs_ideal,
            "quality": self.quality,
            "credits_est_total": self.credits_est_total,
        }


class LeadEvalTrace:
    """Collects per-stage enrichment telemetry for eval runs."""

    def __init__(self, raw: RawLead, *, run_id: str) -> None:
        self.raw = raw
        self.run_id = run_id
        self.stages: list[StageRecord] = []
        self.tier2_gate_reason = ""
        self.gateway_ran = False

    def record(
        self,
        stage: str,
        *,
        ran: bool,
        reason: str = "",
        credits_est: int = 0,
        inputs: dict[str, Any] | None = None,
        outputs: dict[str, Any] | None = None,
        quality: dict[str, Any] | None = None,
    ) -> None:
        if stage == "tier2_gate":
            self.tier2_gate_reason = reason
        if stage == "gateway" and ran:
            self.gateway_ran = True
        self.stages.append(
            StageRecord(
                stage=stage,
                ran=ran,
                reason=reason,
                credits_est=credits_est,
                inputs=inputs or {},
                outputs=outputs or {},
                quality=quality or {},
            )
        )

    def finalize(self, enriched: EnrichedLead, *, config_dir: Path | None = None) -> LeadEvalReport:
        from pallares_leads.enrich.contact_requirements import (
            get_enrichment_rules,
            sales_gaps_vs_ideal,
        )
        from pallares_leads.enrich.contacts_format import format_contacts_block, primary_phone
        from pallares_leads.eval.score import score_lead_report

        export_preview = {
            "exterior_notes": enriched.exterior_cleaning_need_signals,
            "phone": primary_phone(enriched),
            "contacts": format_contacts_block(enriched),
            "website": enriched.website or "",
            "confidence": enriched.confidence.value,
            "status": enriched.sales_status(),
        }
        credits_total = sum(s.credits_est for s in self.stages)
        report = LeadEvalReport(
            place_id=enriched.place_id,
            business_name=enriched.business_name,
            category=enriched.lead_category,
            property_type=enriched.property_type,
            run_id=self.run_id,
            timestamp=datetime.now(tz=UTC).isoformat(),
            stages=list(self.stages),
            tier2_gate_reason=self.tier2_gate_reason,
            final_source_tool=enriched.source_tool,
            export_preview=export_preview,
            credits_est_total=credits_total,
        )
        report.gaps_vs_ideal = sales_gaps_vs_ideal(
            enriched,
            get_enrichment_rules(enriched.property_type, config_dir),
        )
        report.quality = score_lead_report(report, enriched)
        return report


def write_lead_report(report: LeadEvalReport, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report.to_dict(), indent=2), encoding="utf-8")

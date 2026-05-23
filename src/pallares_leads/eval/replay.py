from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pallares_leads.db.store import LeadStore
from pallares_leads.enrich.firecrawl_client import FirecrawlClient
from pallares_leads.eval.compare import compare_to_prior, write_compare
from pallares_leads.eval.judge import judge_lead_report
from pallares_leads.eval.trace import LeadEvalTrace, write_lead_report
from pallares_leads.pipeline.export_csv import export_csv
from pallares_leads.pipeline.export_sheets import export_sheets, sheets_configured
from pallares_leads.pipeline.run_market import enrich_lead
from pallares_leads.schemas import EnrichedLead, RawLead
from pallares_leads.settings import Settings

logger = logging.getLogger(__name__)

PROPERTY_TYPE_ORDER = {
    "gas_station": 0,
    "gas": 0,
    "fast_food": 1,
    "fast": 1,
    "grocery": 2,
    "medical_plaza": 3,
    "shopping_center": 4,
    "strip_mall": 5,
    "strip": 5,
    "property_manager": 6,
}


def load_raw_leads_from_jsonl(
    source: Path,
    *,
    limit: int | None = None,
    place_ids: set[str] | None = None,
) -> list[RawLead]:
    """Load RawLead records from a JSONL file or directory (deduped by place_id)."""
    paths: list[Path]
    if source.is_dir():
        paths = sorted(source.glob("*.jsonl"))
    else:
        paths = [source]

    by_id: dict[str, RawLead] = {}
    for path in paths:
        if not path.is_file():
            continue
        parts = path.stem.split("_")
        default_market = parts[0] if parts else ""
        default_category = parts[1] if len(parts) >= 2 else ""
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                data = json.loads(line)
                lead = RawLead.model_validate(data)
                if not lead.market_key and default_market:
                    lead = lead.model_copy(update={"market_key": default_market})
                if not lead.property_type and default_category:
                    lead = lead.model_copy(update={"property_type": default_category})
                if place_ids is not None and lead.place_id not in place_ids:
                    continue
                by_id[lead.place_id] = lead

    ordered = sorted(
        by_id.values(),
        key=lambda lead: (
            PROPERTY_TYPE_ORDER.get(lead.property_type, 99),
            lead.city,
            lead.business_name,
        ),
    )
    if limit is not None:
        return ordered[:limit]
    return ordered


def _batch_leads(leads: list[RawLead], batch_size: int) -> list[list[RawLead]]:
    return [leads[i : i + batch_size] for i in range(0, len(leads), batch_size)]


def _category_label(leads: list[RawLead]) -> str:
    types = sorted({lead.property_type for lead in leads})
    return "+".join(types) if len(types) <= 2 else "mixed"


def _write_summary(
    path: Path,
    *,
    run_id: str,
    reports: list[dict[str, Any]],
    batch_summaries: list[dict[str, Any]],
) -> None:
    agent_ran = sum(1 for report in reports if report.get("agent_actually_ran"))
    credits = sum(int(report.get("credits_est_total") or 0) for report in reports)
    verdicts: dict[str, int] = {}
    llm_agent: dict[str, int] = {}
    sales_ready = 0
    gate_correct = 0
    judged = 0
    heuristic_sales_ready = 0
    for report in reports:
        verdict = (report.get("quality") or {}).get("agent_necessity_verdict", "unknown")
        verdicts[verdict] = verdicts.get(verdict, 0) + 1
        q = report.get("quality") or {}
        if int(q.get("contact_score") or 0) >= 2 and int(q.get("copy_score") or 0) >= 2:
            heuristic_sales_ready += 1
        judge = report.get("llm_judge") or {}
        if judge:
            judged += 1
            if judge.get("sales_ready"):
                sales_ready += 1
            if judge.get("agent_gate_correct"):
                gate_correct += 1
            necessity = judge.get("agent_necessity", "unknown")
            llm_agent[necessity] = llm_agent.get(necessity, 0) + 1

    payload = {
        "run_id": run_id,
        "timestamp": datetime.now(tz=UTC).isoformat(),
        "lead_count": len(reports),
        "agent_ran_count": agent_ran,
        "agent_rate": round(agent_ran / len(reports), 3) if reports else 0,
        "credits_est_total": credits,
        "agent_necessity_verdicts": verdicts,
        "llm_judge_count": judged,
        "llm_sales_ready_count": sales_ready,
        "llm_agent_gate_correct_count": gate_correct,
        "llm_agent_necessity_verdicts": llm_agent,
        "heuristic_sales_ready_count": heuristic_sales_ready,
        "heuristic_sales_ready_rate": (
            round(heuristic_sales_ready / len(reports), 3) if reports else 0
        ),
        "batches": batch_summaries,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def write_findings_md(path: Path, summary: dict[str, Any], reports: list[dict[str, Any]]) -> None:
    lines = [
        "# Enrichment Eval Findings",
        "",
        f"**Run ID:** `{summary.get('run_id', '')}`",
        f"**Leads evaluated:** {summary.get('lead_count', 0)}",
        f"**Agent ran:** {summary.get('agent_ran_count', 0)} "
        f"({summary.get('agent_rate', 0) * 100:.1f}%)",
        f"**Estimated Firecrawl credits:** {summary.get('credits_est_total', 0)}",
        "",
        "## Agent necessity verdicts",
        "",
    ]
    for verdict, count in sorted((summary.get("agent_necessity_verdicts") or {}).items()):
        lines.append(f"- **{verdict}:** {count}")

    if summary.get("llm_judge_count"):
        lines.extend(
            [
                "",
                "## LLM judge (AI Gateway)",
                "",
                f"- **Judged:** {summary.get('llm_judge_count', 0)} leads",
                f"- **Sales-ready:** {summary.get('llm_sales_ready_count', 0)}",
                f"- **Agent gate correct:** {summary.get('llm_agent_gate_correct_count', 0)}",
                "",
                "### LLM agent necessity",
                "",
            ]
        )
        for verdict, count in sorted((summary.get("llm_agent_necessity_verdicts") or {}).items()):
            lines.append(f"- **{verdict}:** {count}")

    lines.extend(["", "## Per-category notes", ""])
    by_type: dict[str, list[dict[str, Any]]] = {}
    for report in reports:
        by_type.setdefault(report.get("property_type", "unknown"), []).append(report)

    for property_type in sorted(by_type):
        batch = by_type[property_type]
        agent_count = sum(1 for report in batch if report.get("agent_actually_ran"))
        lines.append(f"### {property_type} ({len(batch)} leads, {agent_count} Agent runs)")
        for report in batch:
            name = report.get("business_name", "")
            gate = report.get("agent_gate_reason", "")
            verdict = (report.get("quality") or {}).get("agent_necessity_verdict", "")
            gaps = ", ".join(report.get("gaps_vs_ideal") or []) or "none"
            judge = report.get("llm_judge") or {}
            judge_note = ""
            if judge:
                judge_note = (
                    f"; LLM: sales_ready={judge.get('sales_ready')}, "
                    f"agent={judge.get('agent_necessity')}, "
                    f"hint={judge.get('optimization_hint', '')[:80]}"
                )
            lines.append(f"- **{name}** — gate: {gate}; verdict: {verdict}; gaps: {gaps}{judge_note}")
        lines.append("")

    lines.extend(
        [
            "## Optimization backlog",
            "",
            "Review leads where LLM judge flagged `agent=required` but Agent did not run.",
            "Tune `enrichment` rules in config/categories.yaml — not hardcoded category lists in Python.",
            "",
            "- **min_contact_bar:** form < email < phone < labeled_phone",
            "- **require_property_manager_clue:** for multi-tenant retail (strip_mall, shopping_center)",
            "- **always_investigate:** run Firecrawl even when Google listing looks complete",
            "- **All categories:** AI Gateway handles copy; Agent is for contact discovery only",
            "",
        ]
    )
    path.write_text("\n".join(lines), encoding="utf-8")


def run_eval_replay(
    settings: Settings,
    *,
    from_jsonl: Path,
    batch_size: int = 3,
    limit: int | None = None,
    skip_sheets: bool = True,
    sync_sheets: bool = False,
    batch_offset: int = 0,
    batch_limit: int | None = None,
    db_only: bool = False,
    use_llm_judge: bool = True,
    learn_profiles: bool = True,
) -> Path:
    if not settings.firecrawl_api_key:
        raise ValueError("FIRECRAWL_API_KEY is required for eval replay")

    run_id = datetime.now(tz=UTC).strftime("eval_%Y%m%d_%H%M%S")
    eval_dir = settings.data_dir / "evals" / run_id
    leads_dir = eval_dir / "leads"
    batches_dir = eval_dir / "batches"
    compare_dir = eval_dir / "compare"
    judge_dir = eval_dir / "judge"
    output_dir = eval_dir / "output"
    eval_dir.mkdir(parents=True, exist_ok=True)

    place_ids: set[str] | None = None
    if db_only:
        with LeadStore(settings.db_path) as store:
            place_ids = store.list_enriched_place_ids()
        if not place_ids:
            raise ValueError("No enriched leads in DB — run smoke-sample first or omit --db-only")

    all_leads = load_raw_leads_from_jsonl(from_jsonl, limit=limit, place_ids=place_ids)
    if not all_leads:
        raise ValueError(f"No leads found in {from_jsonl}")

    batches = _batch_leads(all_leads, batch_size)
    if batch_offset:
        batches = batches[batch_offset:]
    if batch_limit is not None:
        batches = batches[:batch_limit]

    firecrawl = FirecrawlClient(settings)
    all_enriched: list[EnrichedLead] = []
    all_reports: list[dict[str, Any]] = []
    batch_summaries: list[dict[str, Any]] = []

    with LeadStore(settings.db_path) as store:
        db_run_id = store.start_run(run_type="eval_replay", market_key="", category_key="")

        for batch_idx, batch in enumerate(batches, start=batch_offset + 1):
            batch_enriched: list[EnrichedLead] = []
            batch_reports: list[dict[str, Any]] = []
            logger.info(
                "Eval batch %02d (%s): %d lead(s)",
                batch_idx,
                _category_label(batch),
                len(batch),
            )

            for lead_idx, raw in enumerate(batch, start=1):
                logger.info(
                    "  [%d/%d] %s — replay enrich",
                    lead_idx,
                    len(batch),
                    raw.business_name,
                )
                trace = LeadEvalTrace(raw, run_id=run_id)
                enriched = enrich_lead(
                    raw,
                    firecrawl,
                    settings,
                    trace=trace,
                    store=store,
                    run_id=db_run_id,
                    learn_profiles=learn_profiles,
                )
                report = trace.finalize(enriched, config_dir=settings.config_dir)
                report_dict = report.to_dict()

                diff = compare_to_prior(
                    snapshots_dir=settings.snapshots_dir,
                    market_key=raw.market_key,
                    property_type=raw.property_type,
                    business_name=raw.business_name,
                    new_report=report_dict,
                )
                write_compare(compare_dir / f"{raw.place_id}_diff.json", diff)

                if use_llm_judge:
                    raw_input = {
                        "main_phone": raw.main_phone,
                        "website": raw.website,
                        "city": raw.city,
                        "formatted_address": raw.formatted_address,
                    }
                    judge = judge_lead_report(
                        report_dict,
                        settings,
                        prior_diff=diff,
                        raw_input=raw_input,
                        config_dir=settings.config_dir,
                    )
                    if judge:
                        report.llm_judge = judge.model_dump()
                        report_dict = report.to_dict()
                        judge_dir.mkdir(parents=True, exist_ok=True)
                        (judge_dir / f"{raw.place_id}.json").write_text(
                            json.dumps(report.llm_judge, indent=2),
                            encoding="utf-8",
                        )
                        logger.info(
                            "  LLM judge: sales_ready=%s agent=%s",
                            judge.sales_ready,
                            judge.agent_necessity,
                        )

                batch_enriched.append(enriched)
                batch_reports.append(report_dict)
                write_lead_report(report, leads_dir / f"{raw.place_id}.json")

                parts = raw.market_key.split("_") if raw.market_key else ["eval"]
                category_key = raw.property_type or "unknown"
                store.upsert_enriched(
                    enriched,
                    market_key=raw.market_key or parts[0],
                    category_key=category_key,
                    run_id=db_run_id,
                    csv_path=str(output_dir / f"batch_{batch_idx:02d}.csv"),
                )

            csv_path = output_dir / f"batch_{batch_idx:02d}.csv"
            export_csv(batch_enriched, csv_path)
            all_enriched.extend(batch_enriched)
            all_reports.extend(batch_reports)

            agent_in_batch = sum(1 for report in batch_reports if report.get("agent_actually_ran"))
            batch_summary = {
                "batch": batch_idx,
                "label": _category_label(batch),
                "lead_count": len(batch),
                "agent_ran": agent_in_batch,
                "credits_est": sum(int(r.get("credits_est_total") or 0) for r in batch_reports),
                "leads": [r.get("place_id") for r in batch_reports],
            }
            batch_summaries.append(batch_summary)
            batches_dir.mkdir(parents=True, exist_ok=True)
            (batches_dir / f"batch_{batch_idx:02d}_{_category_label(batch)}.json").write_text(
                json.dumps({"summary": batch_summary, "reports": batch_reports}, indent=2),
                encoding="utf-8",
            )

        store.finish_run(
            db_run_id,
            discovered_count=len(all_leads),
            skipped_known_count=0,
            enriched_count=len(all_enriched),
        )

    summary_path = eval_dir / "summary.json"
    _write_summary(summary_path, run_id=run_id, reports=all_reports, batch_summaries=batch_summaries)
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    write_findings_md(eval_dir / "FINDINGS.md", summary, all_reports)

    if sync_sheets and not skip_sheets and sheets_configured(settings):
        added = export_sheets(all_enriched, settings)
        logger.info("Google Sheets: %d row(s) appended from eval replay", added)
    elif sync_sheets and skip_sheets:
        logger.info("Sheets sync skipped (--skip-sheets)")

    logger.info("Eval replay complete: %s", eval_dir)
    return eval_dir, summary

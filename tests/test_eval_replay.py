from __future__ import annotations

import json
from pathlib import Path

from pallares_leads.enrich.contact_requirements import clear_enrichment_rules_cache
from pallares_leads.eval.replay import load_raw_leads_from_jsonl
from pallares_leads.eval.trace import LeadEvalTrace
from pallares_leads.schemas import EnrichedLead, RawLead
from pallares_leads.settings import Settings


def test_load_raw_leads_dedupes_by_place_id(tmp_path: Path) -> None:
    path = tmp_path / "reedley_gas_station_2026-05-22.jsonl"
    lead = {
        "place_id": "ChIJtest1",
        "business_name": "Shell",
        "formatted_address": "701 I St, Reedley, CA",
        "city": "Reedley",
        "state": "CA",
        "property_type": "gas_station",
        "lead_category": "Gas Station",
        "website": "https://find.shell.com/123",
    }
    path.write_text(json.dumps(lead) + "\n" + json.dumps(lead) + "\n", encoding="utf-8")

    loaded = load_raw_leads_from_jsonl(tmp_path)
    assert len(loaded) == 1
    assert loaded[0].market_key == "reedley"


def test_lead_eval_trace_finalize() -> None:
    clear_enrichment_rules_cache()
    settings = Settings()
    raw = RawLead(
        place_id="ChIJtest",
        business_name="Test Mall",
        formatted_address="100 Main St, Reedley, CA",
        city="Reedley",
        state="CA",
        property_type="strip_mall",
        lead_category="Strip Mall",
        website="https://example.com",
        main_phone="(559) 638-0100",
    )
    trace = LeadEvalTrace(raw, run_id="eval_test")
    trace.record("gaps", ran=True, reason="none")
    trace.tier2_gate_reason = "Tier 1 satisfied contact requirements"

    enriched = EnrichedLead.model_validate(raw.model_dump())
    enriched.why_this_is_a_good_fit = "Reedley strip mall on Main St."
    enriched.sales_talking_points = "• Local retail traffic"
    enriched.source_tool = "google_places+firecrawl_scrape_json+ai_gateway_copy"

    report = trace.finalize(enriched, config_dir=settings.config_dir)
    assert report.place_id == "ChIJtest"
    assert report.run_id == "eval_test"
    assert report.quality["contact_score"] >= 2

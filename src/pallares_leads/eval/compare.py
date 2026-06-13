from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pallares_leads.utils.normalize import slugify


def _load_snapshot(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def find_prior_snapshots(
    snapshots_dir: Path, raw_market_key: str, property_type: str, business_name: str
) -> dict[str, Path]:
    base = snapshots_dir / slugify(raw_market_key) / slugify(property_type)
    stem = slugify(business_name)
    found: dict[str, Path] = {}
    if not base.is_dir():
        return found
    for suffix, key in (
        ("_agent.json", "agent"),
        ("_extract.json", "extract"),
        ("_scrape_json.json", "scrape_json"),
    ):
        path = base / f"{stem}{suffix}"
        if path.is_file():
            found[key] = path
    md_path = base / f"{stem}.md"
    if md_path.is_file():
        found["markdown"] = md_path
    return found


def compare_to_prior(
    *,
    snapshots_dir: Path,
    market_key: str,
    property_type: str,
    business_name: str,
    new_report: dict[str, Any],
) -> dict[str, Any]:
    prior_paths = find_prior_snapshots(snapshots_dir, market_key, property_type, business_name)
    diff: dict[str, Any] = {"prior_artifacts": {k: str(v) for k, v in prior_paths.items()}}

    old_agent = _load_snapshot(prior_paths["agent"]) if "agent" in prior_paths else None
    old_extract = (
        _load_snapshot(prior_paths.get("extract", Path())) if "extract" in prior_paths else None
    )
    if old_extract is None and "scrape_json" in prior_paths:
        old_extract = _load_snapshot(prior_paths["scrape_json"])

    old_result = None
    if old_agent:
        old_result = old_agent.get("result")
        diff["prior_tier"] = "agent"
    elif old_extract:
        old_result = old_extract.get("result")
        diff["prior_tier"] = old_extract.get("tier", "extract")

    if old_result and isinstance(old_result, dict):
        new_preview = new_report.get("export_preview") or {}
        diff["contact_phone"] = {
            "old": old_result.get("contact_phone") or "",
            "new": new_preview.get("phone") or "",
        }
        diff["why_call"] = {
            "old": old_result.get("pitch_angle") or "",
            "new": new_preview.get("why_call") or "",
        }
        diff["tier2_gate"] = {
            "old": "",
            "new": new_report.get("tier2_gate_reason", ""),
        }

    return diff


def write_compare(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

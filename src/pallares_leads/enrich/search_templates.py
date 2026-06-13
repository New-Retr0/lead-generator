from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

_DEFAULT_TEMPLATES: dict[str, str] = {
    "website_discovery": "{business_name} {city} {state} official website contact",
    "contact_gap_corporate": "site:{host} {city} phone contact",
    "contact_gap_local": '"{business_name}" {city} {state} phone contact',
    "map_contact_search": "contact leasing management facilities about team",
}


def load_search_templates(config_dir: Path | None = None) -> dict[str, str]:
    if config_dir is None:
        from pallares_leads.settings import get_settings

        config_dir = get_settings().config_dir
    path = config_dir / "search_templates.yaml"
    if not path.is_file():
        return dict(_DEFAULT_TEMPLATES)
    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    templates = data.get("templates") if isinstance(data, dict) else {}
    if not isinstance(templates, dict):
        return dict(_DEFAULT_TEMPLATES)
    merged = dict(_DEFAULT_TEMPLATES)
    for key, value in templates.items():
        if isinstance(value, str) and value.strip():
            merged[str(key)] = value.strip()
    return merged


def render_search_template(name: str, *, config_dir: Path | None = None, **fields: Any) -> str:
    templates = load_search_templates(config_dir)
    template = templates.get(name)
    if not template:
        raise KeyError(f"Unknown search template: {name}")
    return template.format(**fields)

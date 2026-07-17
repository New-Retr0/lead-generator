from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic_core import PydanticUndefined

from pallares_leads.settings import Settings, get_settings

SECRET_FIELDS = frozenset(
    {
        "google_places_api_key",
        "firecrawl_api_key",
        "ai_gateway_api_key",
        "browser_use_api_key",
        "supabase_anon_key",
        "supabase_service_role_key",
        "supabase_db_url",
    }
)

READONLY_FIELDS = frozenset(
    {
        "project_root",
        "config_dir",
        "data_dir",
        "raw_dir",
        "snapshots_dir",
        "output_dir",
        "runs_dir",
        "exports_dir",
        "local_cache_path",
        "raw_archive_path",
    }
)


def field_to_env_key(name: str) -> str:
    return name.upper()


def _serialize_value(val: Any) -> Any:
    if isinstance(val, Path):
        return str(val)
    if val is PydanticUndefined:
        return None
    return val


def _field_default(field_info: Any) -> Any:
    if field_info.default is not PydanticUndefined:
        return field_info.default
    if field_info.default_factory is not None:
        return field_info.default_factory()
    return None


def _parse_env_keys(env_path: Path) -> set[str]:
    if not env_path.is_file():
        return set()
    keys: set[str] = set()
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        eq = stripped.find("=")
        if eq > 0:
            keys.add(stripped[:eq].strip())
    return keys


def export_settings_schema() -> dict[str, Any]:
    settings = get_settings()
    schema = Settings.model_json_schema()
    env_keys_present = _parse_env_keys(settings.project_root / ".env")

    values: dict[str, Any] = {}
    defaults: dict[str, Any] = {}

    for name, field_info in Settings.model_fields.items():
        current = getattr(settings, name)
        default = _field_default(field_info)
        env_key = field_to_env_key(name)
        modified = env_key in env_keys_present
        defaults[name] = _serialize_value(default)

        if name in SECRET_FIELDS:
            text = str(current) if current else ""
            masked = f"•••{text[-4:]}" if len(text) >= 4 else ("•••" if text else "")
            values[name] = {
                "masked": masked,
                "is_set": bool(text),
                "modified": modified,
                "env_key": env_key,
                "readonly": name in READONLY_FIELDS,
            }
        else:
            values[name] = {
                "value": _serialize_value(current),
                "default": _serialize_value(default),
                "modified": modified,
                "env_key": env_key,
                "readonly": name in READONLY_FIELDS,
            }

    return {
        "schema": schema,
        "values": values,
        "defaults": defaults,
        "env_keys_present": sorted(env_keys_present),
        "secret_fields": sorted(SECRET_FIELDS),
        "readonly_fields": sorted(READONLY_FIELDS),
    }


def print_settings_schema() -> int:
    print(json.dumps(export_settings_schema(), indent=2))
    return 0

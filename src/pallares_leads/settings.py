from pathlib import Path
from typing import Any

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _find_project_root() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "pyproject.toml").exists():
            return parent
    return here.parents[2]


def _meta(
    group: str,
    *,
    secret: bool = False,
    readonly: bool = False,
    help: str = "",
) -> dict[str, Any]:
    extra: dict[str, Any] = {"group": group}
    if secret:
        extra["secret"] = True
    if readonly:
        extra["readonly"] = True
    if help:
        extra["help"] = help
    return extra


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    google_places_api_key: str = Field(
        default="",
        json_schema_extra=_meta(
            "Credentials",
            secret=True,
            help="Google Places API (New) key for discovery",
        ),
    )
    firecrawl_api_key: str = Field(
        default="",
        json_schema_extra=_meta(
            "Credentials", secret=True, help="Firecrawl API key for enrichment"
        ),
    )
    google_sheets_spreadsheet_id: str = Field(
        default="",
        json_schema_extra=_meta("Credentials", help="Optional Google Sheets export target"),
    )
    google_service_account_json: str = Field(
        default="",
        json_schema_extra=_meta(
            "Credentials",
            secret=True,
            help="Path to service account JSON for Sheets export",
        ),
    )
    google_sheets_tab_name: str = Field(
        default="Leads",
        json_schema_extra=_meta("Credentials", help="Worksheet tab name for Sheets export"),
    )

    supabase_url: str = Field(
        default="",
        json_schema_extra=_meta("Supabase", help="Supabase project URL"),
    )
    supabase_anon_key: str = Field(
        default="",
        json_schema_extra=_meta("Supabase", secret=True, help="Supabase anon key"),
    )
    supabase_service_role_key: str = Field(
        default="",
        json_schema_extra=_meta(
            "Supabase", secret=True, help="Supabase service role key (server only)"
        ),
    )
    supabase_db_url: str = Field(
        default="",
        json_schema_extra=_meta(
            "Supabase",
            secret=True,
            help="Direct Postgres connection string (db.<ref>.supabase.co)",
        ),
    )

    project_root: Path = Field(
        default_factory=_find_project_root,
        json_schema_extra=_meta("Paths", readonly=True, help="Repository root (computed)"),
    )
    config_dir: Path = Field(
        default_factory=lambda: _find_project_root() / "config",
        json_schema_extra=_meta("Paths", readonly=True, help="YAML config directory"),
    )
    data_dir: Path = Field(
        default_factory=lambda: _find_project_root() / "data",
        json_schema_extra=_meta("Paths", readonly=True, help="Local data directory"),
    )
    raw_dir: Path = Field(
        default_factory=lambda: _find_project_root() / "data" / "raw",
        json_schema_extra=_meta("Paths", readonly=True),
    )
    snapshots_dir: Path = Field(
        default_factory=lambda: _find_project_root() / "data" / "snapshots",
        json_schema_extra=_meta("Paths", readonly=True),
    )
    output_dir: Path = Field(
        default_factory=lambda: _find_project_root() / "data" / "output",
        json_schema_extra=_meta("Paths", readonly=True),
    )
    runs_dir: Path = Field(
        default_factory=lambda: _find_project_root() / "data" / "runs",
        json_schema_extra=_meta("Paths", readonly=True),
    )
    exports_dir: Path = Field(
        default_factory=lambda: _find_project_root() / "data" / "exports",
        json_schema_extra=_meta("Paths", readonly=True),
    )
    local_cache_path: Path = Field(
        default_factory=lambda: _find_project_root() / "data" / "local_cache.db",
        json_schema_extra=_meta(
            "Caching & Archive", readonly=True, help="SQLite page/domain cache"
        ),
    )
    raw_archive_path: Path = Field(
        default_factory=lambda: _find_project_root() / "data" / "raw_archive.db",
        json_schema_extra=_meta(
            "Caching & Archive",
            readonly=True,
            help="Compressed raw API response archive",
        ),
    )
    raw_capture_enabled: bool = Field(
        default=True,
        json_schema_extra=_meta(
            "Caching & Archive", help="Store raw API payloads in raw_archive.db"
        ),
    )
    raw_capture_max_bytes: int = Field(
        default=400_000,
        json_schema_extra=_meta(
            "Caching & Archive",
            help="Truncate individual raw captures beyond this size",
        ),
    )
    page_cache_ttl_days: int = Field(
        default=7,
        json_schema_extra=_meta("Caching & Archive", help="Firecrawl page cache TTL in days"),
    )
    domain_cache_ttl_hours: int = Field(
        default=24,
        json_schema_extra=_meta("Caching & Archive", help="Website domain validation cache TTL"),
    )

    learned_score_weight: float = Field(
        default=0.0,
        json_schema_extra=_meta(
            "Scoring",
            help="Blend weight for learned score (0 = heuristic only; enable after --fit-score)",
        ),
    )
    learned_score_min_labels: int = Field(
        default=150,
        json_schema_extra=_meta("Scoring", help="Minimum labeled outcomes before --fit-score runs"),
    )
    min_export_score: int = Field(
        default=25,
        json_schema_extra=_meta("Scoring", help="Minimum lead_score for CSV export"),
    )

    places_search_radius_m: int = Field(
        default=25_000,
        json_schema_extra=_meta("Discovery", help="Nearby Search radius in meters"),
    )
    max_places_per_query: int = Field(
        default=20,
        json_schema_extra=_meta("Discovery", help="Max Places results per query page"),
    )

    firecrawl_timeout_ms: int = Field(
        default=30_000,
        json_schema_extra=_meta("Firecrawl", help="Scrape/map/search timeout in milliseconds"),
    )
    firecrawl_scrape_max_age_ms: int = Field(
        default=172_800_000,
        json_schema_extra=_meta(
            "Firecrawl", help="Use Firecrawl cache when younger than this (ms)"
        ),
    )
    firecrawl_max_concurrency: int = Field(
        default=50,
        json_schema_extra=_meta(
            "Firecrawl", help="Max concurrent Firecrawl requests (plan limit 50)"
        ),
    )
    firecrawl_max_credits_per_run: int = Field(
        default=0,
        json_schema_extra=_meta("Firecrawl", help="Stop enrichment when exceeded (0 = unlimited)"),
    )
    firecrawl_session_credit_stop: int = Field(
        default=0,
        json_schema_extra=_meta(
            "Firecrawl",
            help="Refuse new runs when total credits exceed this (0 = off)",
        ),
    )
    enrichment_parallel_workers: int = Field(
        default=4,
        json_schema_extra=_meta(
            "Firecrawl", help="Parallel lead enrichment threads per market run"
        ),
    )

    ai_gateway_api_key: str = Field(
        default="",
        json_schema_extra=_meta("AI Gateway", secret=True, help="Vercel AI Gateway API key"),
    )
    ai_gateway_model: str = Field(
        default="",
        json_schema_extra=_meta(
            "AI Gateway", help="Default model slug (empty = pricing.yaml default)"
        ),
    )
    ai_gateway_enabled: bool = Field(
        default=True,
        json_schema_extra=_meta(
            "AI Gateway", help="Use AI Gateway for contact extract and sales copy"
        ),
    )
    ai_gateway_max_context_chars: int = Field(
        default=8000,
        json_schema_extra=_meta("AI Gateway", help="Max markdown chars sent to extract prompt"),
    )
    ai_gateway_min_interval_s: float = Field(
        default=4.0,
        json_schema_extra=_meta("AI Gateway", help="Minimum seconds between AI Gateway calls"),
    )
    ai_gateway_max_retries: int = Field(
        default=5,
        json_schema_extra=_meta("AI Gateway", help="Max retries on rate limit / transient errors"),
    )
    ai_gateway_retry_base_delay_s: float = Field(
        default=3.0,
        json_schema_extra=_meta("AI Gateway", help="Base delay for exponential backoff"),
    )
    ai_gateway_rate_limit_cooldown_s: float = Field(
        default=90.0,
        json_schema_extra=_meta("AI Gateway", help="Cooldown after sustained 429 responses"),
    )

    browser_use_enabled: bool = Field(
        default=False,
        json_schema_extra=_meta(
            "Owner Chain", help="Enable Browser Use Cloud for owner-chain lookups"
        ),
    )
    browser_use_backend: str = Field(
        default="cloud",
        json_schema_extra=_meta("Owner Chain", help="Browser Use backend (cloud)"),
    )
    browser_use_api_key: str = Field(
        default="",
        json_schema_extra=_meta("Owner Chain", secret=True, help="Browser Use Cloud API key"),
    )
    browser_use_task_timeout_s: float = Field(
        default=300.0,
        json_schema_extra=_meta("Owner Chain", help="Owner-chain browser task timeout in seconds"),
    )
    owner_chain_backend: str = Field(
        default="browser_use",
        json_schema_extra=_meta(
            "Owner Chain",
            help="Owner chain backend: browser_use | firecrawl_agent",
        ),
    )
    owner_chain_max_per_run: int = Field(
        default=10,
        json_schema_extra=_meta("Owner Chain", help="Max owner-chain lookups per run"),
    )
    loopnet_max_per_run: int = Field(
        default=5,
        json_schema_extra=_meta("Owner Chain", help="Max LoopNet lookups per run"),
    )
    source_checklist_max_pages: int = Field(
        default=6,
        json_schema_extra=_meta("Owner Chain", help="Max registry pages per source checklist"),
    )
    ai_owner_disambiguation: bool = Field(
        default=True,
        json_schema_extra=_meta("Owner Chain", help="Use AI Gateway to pick SOS entity match"),
    )
    ai_need_signal_fallback: bool = Field(
        default=False,
        json_schema_extra=_meta("Owner Chain", help="LLM fallback for exterior need signals"),
    )

    def service_account_path(self) -> Path:
        path = Path(self.google_service_account_json)
        if not path.is_absolute():
            path = self.project_root / path
        return path


def get_settings() -> Settings:
    return Settings()

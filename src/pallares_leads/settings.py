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
    title: str = "",
) -> dict[str, Any]:
    extra: dict[str, Any] = {"group": group}
    if secret:
        extra["secret"] = True
    if readonly:
        extra["readonly"] = True
    if help:
        extra["help"] = help
    if title:
        extra["title"] = title
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
        json_schema_extra=_meta("Paths", readonly=True, help="Raw API response dumps"),
    )
    snapshots_dir: Path = Field(
        default_factory=lambda: _find_project_root() / "data" / "snapshots",
        json_schema_extra=_meta("Paths", readonly=True, help="Point-in-time page snapshots"),
    )
    output_dir: Path = Field(
        default_factory=lambda: _find_project_root() / "data" / "output",
        json_schema_extra=_meta("Paths", readonly=True, help="CSV/export output"),
    )
    runs_dir: Path = Field(
        default_factory=lambda: _find_project_root() / "data" / "runs",
        json_schema_extra=_meta("Paths", readonly=True, help="Per-run artifact folders"),
    )
    exports_dir: Path = Field(
        default_factory=lambda: _find_project_root() / "data" / "exports",
        json_schema_extra=_meta("Paths", readonly=True, help="Generated export files"),
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
    researched_miss_reopen_days: int = Field(
        default=90,
        json_schema_extra=_meta(
            "Caching & Archive",
            help=(
                "Re-enrich researched misses (unverified / skipped) after this many days "
                "under skip_known; until then they forever-skip"
            ),
        ),
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
    firecrawl_agent_max_credits: int = Field(
        default=10,
        json_schema_extra=_meta(
            "Firecrawl",
            title="Agent max credits",
            help="Cap Firecrawl /agent credits for hard contact gaps (0 = disabled).",
        ),
    )
    firecrawl_agent_model: str = Field(
        default="spark-1-mini",
        json_schema_extra=_meta("Firecrawl", help="Model for capped Firecrawl agent"),
    )
    firecrawl_agent_timeout_s: int = Field(
        default=180,
        json_schema_extra=_meta(
            "Firecrawl",
            title="Agent timeout (seconds)",
            help="Hard wait cap for Firecrawl /agent (owner-chain + capped agent). "
            "Without this the SDK polls forever and can stall a whole market cell.",
        ),
    )
    enrichment_lead_timeout_s: int = Field(
        default=600,
        json_schema_extra=_meta(
            "Enrichment",
            title="Per-lead timeout (seconds)",
            help="Abandon a single place enrichment after this wall-clock budget so "
            "parallel workers cannot pin a cell at N-2/N forever.",
        ),
    )
    firecrawl_grounding_storm_limit: int = Field(
        default=12,
        json_schema_extra=_meta(
            "Firecrawl",
            help="Pause expensive Firecrawl stages after N grounding rejections in a lead",
        ),
    )
    firecrawl_429_circuit_cooldown_s: float = Field(
        default=60.0,
        json_schema_extra=_meta(
            "Firecrawl",
            help="Cooldown breaker cooldown (seconds) after repeated Firecrawl 429s",
        ),
    )
    firecrawl_search_recency: str = Field(
        default="",
        json_schema_extra=_meta(
            "Firecrawl",
            help="Optional Firecrawl search tbs recency filter (e.g. qdr:w); empty = off",
        ),
    )
    firecrawl_news_search_enabled: bool = Field(
        default=False,
        json_schema_extra=_meta(
            "Firecrawl",
            help="Opt-in Firecrawl news search helper (default off)",
        ),
    )
    firecrawl_change_tracking_enabled: bool = Field(
        default=False,
        json_schema_extra=_meta(
            "Firecrawl",
            help="Opt-in Firecrawl scrape changeTracking helper (default off)",
        ),
    )
    owner_chain_max_per_run: int = Field(
        default=10,
        json_schema_extra=_meta(
            "Owner Chain",
            help="Max Firecrawl agent owner-chain lookups per run",
        ),
    )
    source_checklist_max_pages: int = Field(
        default=6,
        json_schema_extra=_meta("Owner Chain", help="Max registry pages per source checklist"),
    )

def get_settings() -> Settings:
    return Settings()

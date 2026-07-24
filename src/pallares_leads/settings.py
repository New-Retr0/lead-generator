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
    learned_score_weight: float = Field(
        default=0.0,
        json_schema_extra=_meta(
            "Quality",
            title="Learned score weight",
            help="Blend weight for learned score (0 = heuristic only; enable after --fit-score). "
            "Partner eligibility uses verified named DM, not this weight.",
        ),
    )
    learned_score_min_labels: int = Field(
        default=150,
        json_schema_extra=_meta(
            "Quality",
            title="Min labels for fit-score",
            help="Minimum labeled outcomes before insights --fit-score is allowed to run",
        ),
    )
    researched_miss_reopen_days: int = Field(
        default=90,
        json_schema_extra=_meta(
            "Quality",
            title="Researched-miss reopen (days)",
            help=(
                "Re-enrich researched misses (no named DM / skipped) after this many days "
                "under skip_known; until then they forever-skip"
            ),
        ),
    )
    dud_reopen_days: int = Field(
        default=45,
        json_schema_extra=_meta(
            "Quality",
            title="Dud reopen (days)",
            help="Days before a time-boxed dud (temporarily closed, dead site) is "
            "re-discovered. Permanent duds (closed_permanently, opt_out) never reopen.",
        ),
    )

    # NOTE: the single export/eligibility gate lives in the partner_leads_v1 SQL view
    # (enrichment_status='enriched' AND confidence <> 'Low' AND lead_score >= 25 AND
    # is_verified_decision_maker(...)). There is no Python-side min-score knob — a
    # dead `min_export_score` setting was removed 2026-07-20 to avoid a false affordance.
    # Discovery radius comes from config/markets.yaml `search_radius_m` (not a Settings
    # field). Places page size is the API max (20) in discover/places.py.

    firecrawl_timeout_ms: int = Field(
        default=30_000,
        json_schema_extra=_meta(
            "Firecrawl",
            title="Request timeout (ms)",
            help="Scrape/map/search timeout in milliseconds",
        ),
    )
    firecrawl_scrape_max_age_ms: int = Field(
        default=172_800_000,
        json_schema_extra=_meta(
            "Firecrawl",
            title="Scrape cache max age (ms)",
            help="Reuse Firecrawl cached page content when younger than this (default ~48h)",
        ),
    )
    firecrawl_scrape_proxy: str = Field(
        default="basic",
        json_schema_extra=_meta(
            "Firecrawl",
            title="Scrape proxy",
            help=(
                'Primary scrape proxy: "basic" (1 credit) or "auto" '
                "(may bill 5 on enhanced fallback)."
            ),
        ),
    )
    firecrawl_proxy_escalate: bool = Field(
        default=True,
        json_schema_extra=_meta(
            "Firecrawl",
            title="Proxy escalate",
            help=(
                'When primary proxy is "basic", retry once with proxy=auto '
                "on dead-end/captcha pages."
            ),
        ),
    )
    firecrawl_agent_max_credits: int = Field(
        default=10,
        json_schema_extra=_meta(
            "Firecrawl",
            title="Agent max credits",
            help=(
                "Cap Firecrawl /agent credits per call for contact-gap agent and "
                "owner-chain agent (0 = disable both). Skipped automatically when "
                "team remaining credits are below this budget."
            ),
        ),
    )
    firecrawl_agent_model: str = Field(
        default="spark-1-mini",
        json_schema_extra=_meta(
            "Firecrawl",
            title="Agent model",
            help="Model for capped Firecrawl /agent (contact-gap + owner-chain)",
        ),
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
    firecrawl_interact_enabled: bool = Field(
        default=True,
        json_schema_extra=_meta(
            "Firecrawl",
            title="Interact escalation",
            help=(
                "When CRE still lacks a named DM after Tier-1/2, open the last scrape "
                "in Interact to expand Team/Contact UI and re-extract contacts."
            ),
        ),
    )
    firecrawl_interact_timeout_s: int = Field(
        default=90,
        json_schema_extra=_meta(
            "Firecrawl",
            title="Interact timeout (seconds)",
            help="Per-prompt timeout for Firecrawl /interact after scrape.",
        ),
    )
    firecrawl_search_feedback: bool = Field(
        default=True,
        json_schema_extra=_meta(
            "Firecrawl",
            title="Search feedback",
            help=(
                "When Tier-2 search yields no usable contact page, submit search "
                "feedback (may refund 1 credit) so Firecrawl can improve results."
            ),
        ),
    )
    firecrawl_monitor_ready_pages: bool = Field(
        default=False,
        json_schema_extra=_meta(
            "Firecrawl",
            title="Monitor Ready contact pages",
            help=(
                "Opt-in: after a Partner-ready DM is found, create a weekly Firecrawl "
                "page monitor on the contact source URL (charges recurring scrape credits)."
            ),
        ),
    )
    firecrawl_monitor_cron: str = Field(
        default="0 15 * * 1",
        json_schema_extra=_meta(
            "Firecrawl",
            title="Monitor cron",
            help="Cron schedule (UTC) for Ready-page monitors when monitoring is enabled.",
        ),
    )
    enrichment_lead_timeout_s: int = Field(
        default=600,
        json_schema_extra=_meta(
            "Enrichment",
            title="Per-lead timeout (seconds)",
            help="Abandon a single place enrichment after this wall-clock budget so "
            "parallel workers cannot pin a cell forever.",
        ),
    )
    firecrawl_grounding_storm_limit: int = Field(
        default=12,
        json_schema_extra=_meta(
            "Firecrawl",
            title="Grounding storm limit",
            help="Pause expensive Firecrawl stages after N grounding rejections in a lead",
        ),
    )
    firecrawl_429_circuit_cooldown_s: float = Field(
        default=60.0,
        json_schema_extra=_meta(
            "Firecrawl",
            title="429 circuit cooldown (seconds)",
            help="Cooldown after repeated Firecrawl 429s before retrying",
        ),
    )
    firecrawl_search_recency: str = Field(
        default="",
        json_schema_extra=_meta(
            "Firecrawl",
            title="Search recency (tbs)",
            help='Optional Firecrawl search tbs filter (e.g. "qdr:w"); empty = off',
        ),
    )
    owner_chain_max_per_run: int = Field(
        default=10,
        json_schema_extra=_meta(
            "Owner Chain",
            title="Max owner-chain lookups / run",
            help="Cap expensive SOS/recorder agent lookups per market run",
        ),
    )
    source_checklist_max_pages: int = Field(
        default=6,
        json_schema_extra=_meta(
            "Enrichment",
            title="Source checklist max pages",
            help="Max registry/checklist pages scraped per lead when the contact package is thin",
        ),
    )

def get_settings() -> Settings:
    return Settings()

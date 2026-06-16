from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


def _find_project_root() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "pyproject.toml").exists():
            return parent
    return here.parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    google_places_api_key: str = ""
    firecrawl_api_key: str = ""
    google_sheets_spreadsheet_id: str = ""
    google_service_account_json: str = ""
    google_sheets_tab_name: str = "Leads"

    project_root: Path = _find_project_root()
    config_dir: Path = project_root / "config"
    data_dir: Path = project_root / "data"
    raw_dir: Path = data_dir / "raw"
    snapshots_dir: Path = data_dir / "snapshots"
    output_dir: Path = data_dir / "output"
    runs_dir: Path = data_dir / "runs"
    exports_dir: Path = data_dir / "exports"
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_db_url: str = ""
    local_cache_path: Path = data_dir / "local_cache.db"

    page_cache_ttl_days: int = 7

    places_search_radius_m: int = 25_000
    max_places_per_query: int = 20
    firecrawl_timeout_ms: int = 30_000
    firecrawl_scrape_max_age_ms: int = 172_800_000  # 2 days — use Firecrawl cache when available
    firecrawl_max_concurrency: int = 5  # match Firecrawl plan (Hobby = 5)
    firecrawl_max_credits_per_run: int = 0  # 0 = unlimited; stop enrichment when exceeded
    firecrawl_session_credit_stop: int = 0  # 0 = off; refuse new runs when total credits exceed
    enrichment_parallel_workers: int = 1  # parallel lead enrichment threads per market run

    domain_cache_ttl_hours: int = 24

    ai_gateway_api_key: str = ""
    ai_gateway_model: str = ""
    ai_gateway_enabled: bool = True
    ai_gateway_max_context_chars: int = 8000
    # Free-tier flash models are RPM-limited — space calls and retry 429s.
    ai_gateway_min_interval_s: float = 4.0
    ai_gateway_max_retries: int = 5
    ai_gateway_retry_base_delay_s: float = 3.0
    ai_gateway_rate_limit_cooldown_s: float = 90.0

    min_export_score: int = 25

    browser_use_enabled: bool = False
    browser_use_backend: str = "cloud"
    browser_use_api_key: str = ""
    browser_use_task_timeout_s: float = 300.0
    owner_chain_max_per_run: int = 10
    loopnet_max_per_run: int = 5
    source_checklist_max_pages: int = 6

    def service_account_path(self) -> Path:
        path = Path(self.google_service_account_json)
        if not path.is_absolute():
            path = self.project_root / path
        return path


def get_settings() -> Settings:
    return Settings()

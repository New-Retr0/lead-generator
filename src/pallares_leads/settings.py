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
    db_path: Path = data_dir / "pallares.db"

    places_search_radius_m: int = 25_000
    max_places_per_query: int = 20
    firecrawl_timeout_ms: int = 30_000
    firecrawl_scrape_max_age_ms: int = 172_800_000  # 2 days — use Firecrawl cache when available
    firecrawl_enrichment_mode: str = "hybrid"  # hybrid | scrape_only | agent_only
    firecrawl_agent_enabled: bool = False  # last-resort Agent; Map+Search+Gateway by default
    firecrawl_agent_max_credits: int = 75  # cap per lead; set 0 to disable cap
    firecrawl_agent_poll_interval_s: int = 15
    firecrawl_agent_timeout_s: int = 300
    firecrawl_max_concurrency: int = 5  # match Firecrawl plan (Hobby = 5)
    firecrawl_max_credits_per_run: int = 0  # 0 = unlimited; stop enrichment when exceeded
    enrichment_parallel_workers: int = 1  # parallel lead enrichment threads per market run

    domain_cache_ttl_hours: int = 24

    ai_gateway_api_key: str = ""
    ai_gateway_model: str = ""
    ai_gateway_enabled: bool = True
    ai_gateway_max_context_chars: int = 8000

    def service_account_path(self) -> Path:
        path = Path(self.google_service_account_json)
        if not path.is_absolute():
            path = self.project_root / path
        return path


def get_settings() -> Settings:
    return Settings()

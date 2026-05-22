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

    project_root: Path = _find_project_root()
    config_dir: Path = project_root / "config"
    data_dir: Path = project_root / "data"
    raw_dir: Path = data_dir / "raw"
    snapshots_dir: Path = data_dir / "snapshots"
    output_dir: Path = data_dir / "output"

    places_search_radius_m: int = 25_000
    max_places_per_query: int = 20
    firecrawl_timeout_ms: int = 30_000


def get_settings() -> Settings:
    return Settings()

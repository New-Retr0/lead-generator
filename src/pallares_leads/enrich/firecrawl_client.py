from __future__ import annotations

import logging
from typing import Any

import httpx

from pallares_leads.enrich.contact_extract import candidate_paths
from pallares_leads.settings import Settings

logger = logging.getLogger(__name__)


class FirecrawlClient:
    BASE_URL = "https://api.firecrawl.dev/v1"

    def __init__(self, settings: Settings) -> None:
        if not settings.firecrawl_api_key:
            raise ValueError("FIRECRAWL_API_KEY is required for enrichment")
        self._api_key = settings.firecrawl_api_key
        self._timeout_ms = settings.firecrawl_timeout_ms

    def scrape_url(self, url: str) -> str | None:
        with httpx.Client(timeout=60.0) as client:
            response = client.post(
                f"{self.BASE_URL}/scrape",
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "url": url,
                    "formats": ["markdown"],
                    "timeout": self._timeout_ms,
                },
            )
            if response.status_code >= 400:
                logger.warning("Firecrawl scrape failed for %s: %s", url, response.text[:200])
                return None
            payload: dict[str, Any] = response.json()
            data = payload.get("data") or {}
            markdown = data.get("markdown")
            return markdown if isinstance(markdown, str) else None

    def scrape_site(self, website: str, *, max_pages: int = 4) -> list[tuple[str, str]]:
        pages: list[tuple[str, str]] = []
        for url in candidate_paths(website)[:max_pages]:
            markdown = self.scrape_url(url)
            if markdown:
                pages.append((url, markdown))
        return pages

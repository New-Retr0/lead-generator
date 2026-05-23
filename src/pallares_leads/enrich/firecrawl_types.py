from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class FirecrawlStageMeta:
    """Stateless metadata returned alongside Firecrawl operations."""

    stage: str = ""
    website: str = ""
    cached: bool = False
    urls: list[str] = field(default_factory=list)
    query: str = ""
    method: str = ""
    found: str | None = None
    candidates: list[str] = field(default_factory=list)
    target_url: str = ""
    matched_url: str = ""
    credits_est: int = 0
    error: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "stage": self.stage,
            "website": self.website,
            "cached": self.cached,
            "urls": self.urls,
            "query": self.query,
            "method": self.method,
            "found": self.found,
            "candidates": self.candidates,
            "target_url": self.target_url,
            "matched_url": self.matched_url,
            "credits_est": self.credits_est,
            "error": self.error,
        }

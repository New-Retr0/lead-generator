from __future__ import annotations

import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

from pallares_leads.enrich.contact_requirements import (
    EnrichmentRules,
    investigation_meets_bar,
)
from pallares_leads.enrich.google_gaps import is_corporate_locator_url
from pallares_leads.enrich.schema import (
    LEAD_CONTACT_SCHEMA,
    LEAD_INVESTIGATION_SCHEMA,
    LeadInvestigationResult,
    agent_prompt,
    extract_prompt,
)
from pallares_leads.enrich.domain_verify import pick_verified_website_url, verify_website_url
from pallares_leads.enrich.website_discover import candidate_website_urls, is_skipped_domain
from pallares_leads.enrich.firecrawl_types import FirecrawlStageMeta
from pallares_leads.schemas import RawLead
from pallares_leads.settings import Settings
from pallares_leads.utils.http_retry import request_with_retry

logger = logging.getLogger(__name__)

CONTACT_MAP_SEARCH = "contact leasing management facilities about team"
CONTACT_URL_HINTS = ("contact", "leasing", "management", "about", "team", "facilities")
BROKER_PDF_HINTS = ("showcase", "loopnet", "pearson", "cbre", "costar", "crexi", "flyer")
PDF_SNIPPET_MAX_CHARS = 3000
AGENT_SKIP_URL_HINTS = ("maps.google.com", "google.com/maps", "mapquest.com", "goo.gl/maps")


class FirecrawlClient:
    BASE_URL = "https://api.firecrawl.dev/v1"
    AGENT_URL = "https://api.firecrawl.dev/v2/agent"

    def __init__(self, settings: Settings) -> None:
        if not settings.firecrawl_api_key:
            raise ValueError("FIRECRAWL_API_KEY is required for enrichment")
        self._api_key = settings.firecrawl_api_key
        self._timeout_ms = settings.firecrawl_timeout_ms
        self._settings = settings
        self._map_cache: dict[str, list[str]] = {}
        self.last_map_info: dict[str, Any] = {}
        self.last_scrape_target: str = ""
        self.last_search_info: dict[str, Any] = {}
        self.last_contact_search_info: dict[str, Any] = {}
        self.stage_meta: FirecrawlStageMeta = FirecrawlStageMeta()

    def _set_stage_meta(self, meta: FirecrawlStageMeta) -> FirecrawlStageMeta:
        self.stage_meta = meta
        if meta.stage == "map":
            self.last_map_info = meta.to_dict()
        elif meta.stage == "search":
            self.last_search_info = meta.to_dict()
        elif meta.stage == "search_contact":
            self.last_contact_search_info = meta.to_dict()
        if meta.target_url:
            self.last_scrape_target = meta.target_url
        return meta

    def reset_map_cache(self) -> None:
        self._map_cache.clear()

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

    @staticmethod
    def _site_cache_key(website: str) -> str:
        parsed = urlparse(website.split("#")[0])
        origin = f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
        return origin.lower()

    def _scrape_body(
        self,
        url: str,
        *,
        formats: list[str],
        json_prompt: str | None = None,
        contact_schema: bool = False,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "url": url,
            "formats": formats,
            "onlyMainContent": True,
            "timeout": self._timeout_ms,
        }
        if json_prompt is not None:
            body["jsonOptions"] = {
                "prompt": json_prompt,
                "schema": LEAD_CONTACT_SCHEMA if contact_schema else LEAD_INVESTIGATION_SCHEMA,
            }
        if self._settings.firecrawl_scrape_max_age_ms > 0:
            body["maxAge"] = self._settings.firecrawl_scrape_max_age_ms
        return body

    def health_check(self) -> tuple[bool, str]:
        """Cheap validation scrape (uses Firecrawl cache when maxAge is set)."""
        try:
            with httpx.Client(timeout=30.0) as client:
                body: dict[str, Any] = {
                    "url": "https://example.com",
                    "formats": ["markdown"],
                    "onlyMainContent": True,
                    "timeout": 15_000,
                }
                if self._settings.firecrawl_scrape_max_age_ms > 0:
                    body["maxAge"] = self._settings.firecrawl_scrape_max_age_ms
                response = client.post(
                    f"{self.BASE_URL}/scrape",
                    headers=self._headers(),
                    json=body,
                )
                if response.status_code == 200 and response.json().get("success") is not False:
                    return True, "OK (example.com scrape via cache or live)"
                return False, f"HTTP {response.status_code}: {response.text[:200]}"
        except httpx.HTTPError as exc:
            return False, str(exc)

    def map_contact_urls(self, website: str, *, limit: int = 10) -> list[str]:
        """Discover contact/leasing pages on a known domain (1 credit per call)."""
        cache_key = self._site_cache_key(website)
        if cache_key in self._map_cache:
            cached = self._map_cache[cache_key]
            self._set_stage_meta(
                FirecrawlStageMeta(
                    stage="map",
                    website=website,
                    cached=True,
                    urls=cached[:limit],
                    credits_est=0,
                )
            )
            return cached[:limit]

        with httpx.Client(timeout=60.0) as client:
            response = request_with_retry(
                lambda: client.post(
                    f"{self.BASE_URL}/map",
                    headers=self._headers(),
                    json={
                        "url": website,
                        "search": CONTACT_MAP_SEARCH,
                        "limit": limit,
                    },
                ),
                label="Firecrawl map",
            )
            if response.status_code >= 400:
                logger.warning("Firecrawl map failed for %s: %s", website, response.text[:200])
                self._map_cache[cache_key] = []
                self._set_stage_meta(
                    FirecrawlStageMeta(stage="map", website=website, cached=False, urls=[], credits_est=0)
                )
                return []

            payload: dict[str, Any] = response.json()
            links = self._parse_map_links(payload)
            self._map_cache[cache_key] = links
            self._set_stage_meta(
                FirecrawlStageMeta(
                    stage="map",
                    website=website,
                    cached=False,
                    urls=links[:limit],
                    credits_est=1,
                )
            )
            return links[:limit]

    @staticmethod
    def _parse_map_links(payload: dict[str, Any]) -> list[str]:
        links: list[str] = []
        raw_links = payload.get("links") or payload.get("data")
        if not isinstance(raw_links, list):
            return links

        for item in raw_links:
            if isinstance(item, str):
                links.append(item)
            elif isinstance(item, dict):
                url = item.get("url")
                if isinstance(url, str):
                    links.append(url)
        return links

    def _contact_urls_for_site(self, website: str, *, max_pages: int = 4) -> list[str]:
        mapped = self.map_contact_urls(website, limit=max_pages + 2)
        if mapped:
            origin = website.split("#")[0].rstrip("/")
            urls: list[str] = []
            seen: set[str] = set()
            for url in mapped:
                key = url.split("#")[0].rstrip("/")
                if key not in seen:
                    seen.add(key)
                    urls.append(url)
            if origin not in seen:
                urls.insert(0, website)
            return urls[:max_pages]

        return candidate_paths(website)[:max_pages]

    @staticmethod
    def _best_json_target(website: str, mapped: list[str]) -> str:
        for url in mapped:
            lower = url.lower()
            if any(hint in lower for hint in CONTACT_URL_HINTS):
                return url
        return website

    @staticmethod
    def pick_broker_pdf_url(urls: list[str]) -> str | None:
        for url in urls:
            lower = url.lower()
            if ".pdf" not in lower:
                continue
            if any(hint in lower for hint in BROKER_PDF_HINTS):
                return url
        for url in urls:
            if ".pdf" in url.lower():
                return url
        return None

    def scrape_url(self, url: str) -> str | None:
        with httpx.Client(timeout=60.0) as client:
            response = client.post(
                f"{self.BASE_URL}/scrape",
                headers=self._headers(),
                json=self._scrape_body(url, formats=["markdown"]),
            )
            if response.status_code >= 400:
                logger.warning("Firecrawl scrape failed for %s: %s", url, response.text[:200])
                return None
            payload: dict[str, Any] = response.json()
            data = payload.get("data") or {}
            markdown = data.get("markdown")
            return markdown if isinstance(markdown, str) else None

    def scrape_pdf_snippet(self, url: str, *, max_pages: int = 15) -> str | None:
        """Extract markdown from a remote broker PDF via scrape+parsers."""
        body: dict[str, Any] = {
            "url": url,
            "formats": ["markdown"],
            "onlyMainContent": True,
            "timeout": self._timeout_ms,
            "parsers": [{"type": "pdf", "mode": "auto", "maxPages": max_pages}],
        }
        if self._settings.firecrawl_scrape_max_age_ms > 0:
            body["maxAge"] = self._settings.firecrawl_scrape_max_age_ms

        with httpx.Client(timeout=120.0) as client:
            response = client.post(
                f"{self.BASE_URL}/scrape",
                headers=self._headers(),
                json=body,
            )
            if response.status_code >= 400:
                logger.warning("Firecrawl PDF scrape failed for %s: %s", url, response.text[:200])
                return None

            payload: dict[str, Any] = response.json()
            data = payload.get("data") or {}
            markdown = data.get("markdown")
            if not isinstance(markdown, str) or not markdown.strip():
                return None

            snippet = markdown.strip()
            if len(snippet) > PDF_SNIPPET_MAX_CHARS:
                snippet = snippet[:PDF_SNIPPET_MAX_CHARS] + "\n…"
            return snippet

    def scrape_site(self, website: str, *, max_pages: int = 4) -> list[tuple[str, str]]:
        urls = self._contact_urls_for_site(website, max_pages=max_pages)
        if not urls:
            return []

        workers = min(len(urls), max_pages, self._settings.firecrawl_max_concurrency)
        if workers <= 1:
            pages: list[tuple[str, str]] = []
            for url in urls:
                markdown = self.scrape_url(url)
                if markdown:
                    pages.append((url, markdown))
            return pages

        by_url: dict[str, str] = {}
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(self.scrape_url, url): url for url in urls}
            for future in as_completed(futures):
                url = futures[future]
                try:
                    markdown = future.result()
                except Exception as exc:
                    logger.warning("Parallel scrape failed for %s: %s", url, exc)
                    continue
                if markdown:
                    by_url[url] = markdown

        return [(url, by_url[url]) for url in urls if url in by_url]

    def scrape_lead(self, raw: RawLead) -> LeadInvestigationResult | None:
        """Tier-1 structured extraction via scrape+JSON (fixed ~5 credits/page)."""
        if not raw.website:
            return None

        mapped = self.map_contact_urls(raw.website, limit=8)
        target = self._best_json_target(raw.website, mapped)
        self.last_scrape_target = target
        logger.info("  Tier 1 scrape+JSON: %s", target)
        result = self._scrape_json(target, raw)
        if result is not None:
            return result

        for alt_url in mapped:
            if alt_url == target:
                continue
            lower = alt_url.lower()
            if not any(hint in lower for hint in CONTACT_URL_HINTS):
                continue
            logger.info("  Tier 1 scrape+JSON retry: %s", alt_url)
            self.last_scrape_target = alt_url
            result = self._scrape_json(alt_url, raw)
            if result is not None:
                return result
        return None

    def scrape_lead_json_url(self, url: str, raw: RawLead) -> LeadInvestigationResult | None:
        """Structured scrape+JSON for a specific URL (leasing/management pages)."""
        self.last_scrape_target = url
        return self._scrape_json(url, raw)

    def _scrape_json(self, url: str, raw: RawLead) -> LeadInvestigationResult | None:
        with httpx.Client(timeout=120.0) as client:
            response = client.post(
                f"{self.BASE_URL}/scrape",
                headers=self._headers(),
                json=self._scrape_body(
                    url,
                    formats=["json"],
                    json_prompt=extract_prompt(raw),
                    contact_schema=True,
                ),
            )
            if response.status_code >= 400:
                logger.warning(
                    "Firecrawl scrape+JSON failed for %s: %s",
                    url,
                    response.text[:300],
                )
                return None

            payload: dict[str, Any] = response.json()
            if payload.get("success") is False:
                logger.warning("Firecrawl scrape+JSON unsuccessful for %s", url)
                return None

            data = payload.get("data") or {}
            json_blob = data.get("json")
            if isinstance(json_blob, dict):
                result = LeadInvestigationResult.from_api_payload(json_blob)
                if result:
                    return result
            if isinstance(json_blob, str):
                try:
                    parsed = json.loads(json_blob)
                    if isinstance(parsed, dict):
                        result = LeadInvestigationResult.from_api_payload(parsed)
                        if result:
                            return result
                except json.JSONDecodeError:
                    pass

            return self._parse_investigation(payload)

    def search_website(self, raw: RawLead) -> str | None:
        """Find official website when Google Places has none — must pass DNS + HTTP check."""
        verified_guesses: list[str] = []
        for url in candidate_website_urls(raw.business_name):
            base = url.split("#")[0].rstrip("/")
            if verify_website_url(base):
                logger.info("Guessed website verified: %s", base)
                verified_guesses.append(base)
        if verified_guesses:
            found = pick_verified_website_url(verified_guesses, raw.business_name)
            self.last_search_info = {
                "query": "",
                "method": "dns_guess",
                "found": found,
                "candidates": verified_guesses,
            }
            return found

        query = f"{raw.business_name} {raw.city} {raw.state} official website contact"
        body = {"query": query, "limit": 8}
        candidates: list[str] = []

        with httpx.Client(timeout=60.0) as client:
            response = client.post(
                f"{self.BASE_URL}/search",
                headers=self._headers(),
                json=body,
            )
            if response.status_code >= 400:
                logger.warning(
                    "Firecrawl search failed for %s: %s",
                    raw.business_name,
                    response.text[:200],
                )
                self.last_search_info = {
                    "query": query,
                    "method": "search_api",
                    "found": None,
                    "error": response.text[:200],
                }
                return None

            payload: dict[str, Any] = response.json()
            for item in payload.get("data") or []:
                if not isinstance(item, dict):
                    continue
                url = item.get("url") or (item.get("metadata") or {}).get("sourceURL")
                if isinstance(url, str) and url and not is_skipped_domain(url):
                    candidates.append(url)

        found = pick_verified_website_url(candidates, raw.business_name)
        self.last_search_info = {
            "query": query,
            "method": "search_api",
            "found": found,
            "candidates": candidates[:8],
        }
        return found

    @staticmethod
    def _agent_focus_urls(raw: RawLead, focus_urls: list[str] | None) -> list[str]:
        """Drop Maps/locator dead-ends; Agent needs a real site to scrape."""
        seen: set[str] = set()
        urls: list[str] = []
        for url in focus_urls or []:
            if not url:
                continue
            lower = url.lower()
            if any(hint in lower for hint in AGENT_SKIP_URL_HINTS):
                continue
            key = url.split("#")[0].rstrip("/")
            if key not in seen:
                seen.add(key)
                urls.append(url)
        if raw.website:
            lower = raw.website.lower()
            if not any(hint in lower for hint in AGENT_SKIP_URL_HINTS):
                key = raw.website.split("#")[0].rstrip("/")
                if key not in seen:
                    urls.insert(0, raw.website)
        return urls

    def search_contact_gap(
        self,
        raw: RawLead,
        rules: EnrichmentRules,
    ) -> LeadInvestigationResult | None:
        """Tier 2: Firecrawl Search + scrape+JSON (~6 credits) before expensive Agent."""
        queries: list[str] = []
        if raw.website and is_corporate_locator_url(raw.website):
            host = urlparse(raw.website).netloc.replace("www.", "")
            queries.append(f"site:{host} {raw.city} phone contact")
        queries.append(f'"{raw.business_name}" {raw.city} {raw.state} phone contact')

        candidates: list[str] = []
        last_query = ""
        for query in queries[:2]:
            last_query = query
            with httpx.Client(timeout=60.0) as client:
                response = client.post(
                    f"{self.BASE_URL}/search",
                    headers=self._headers(),
                    json={"query": query, "limit": 6},
                )
                if response.status_code >= 400:
                    continue
                payload: dict[str, Any] = response.json()
                for item in payload.get("data") or []:
                    if not isinstance(item, dict):
                        continue
                    url = item.get("url") or (item.get("metadata") or {}).get("sourceURL")
                    if not isinstance(url, str) or not url:
                        continue
                    lower = url.lower()
                    if any(hint in lower for hint in AGENT_SKIP_URL_HINTS):
                        continue
                    if is_skipped_domain(url):
                        continue
                    if url not in candidates:
                        candidates.append(url)

        self.last_contact_search_info = {
            "query": last_query,
            "candidates": candidates[:6],
        }

        for url in candidates[:3]:
            logger.info("  Tier 2 search+JSON: %s", url)
            result = self._scrape_json(url, raw)
            if result and investigation_meets_bar(result, rules, property_type=raw.property_type)[0]:
                self.last_contact_search_info["matched_url"] = url
                return result

        return None

    def investigate_lead(self, raw: RawLead, *, focus_urls: list[str] | None = None) -> LeadInvestigationResult | None:
        urls = self._agent_focus_urls(raw, focus_urls)
        if not urls:
            logger.warning(
                "Agent skipped for %s — no scrapable focus URLs (Maps-only is not valid Agent input)",
                raw.business_name,
            )
            return None

        body: dict[str, Any] = {
            "prompt": agent_prompt(raw),
            "schema": LEAD_INVESTIGATION_SCHEMA,
            "urls": urls,
        }
        max_credits = self._settings.firecrawl_agent_max_credits
        if max_credits:
            body["maxCredits"] = max_credits

        with httpx.Client(timeout=60.0) as client:
            response = client.post(
                self.AGENT_URL,
                headers=self._headers(),
                json=body,
            )
            if response.status_code >= 400:
                logger.warning(
                    "Firecrawl agent start failed for %s: %s",
                    raw.business_name,
                    response.text[:300],
                )
                return None

            payload: dict[str, Any] = response.json()
            job_id = payload.get("id")
            if not job_id:
                return self._parse_investigation(payload)

            final = self._poll_agent(str(job_id))
            return self._parse_investigation(final)

    def _poll_agent(self, job_id: str) -> dict[str, Any]:
        deadline = time.monotonic() + self._settings.firecrawl_agent_timeout_s
        interval = self._settings.firecrawl_agent_poll_interval_s

        with httpx.Client(timeout=60.0) as client:
            while time.monotonic() < deadline:
                response = client.get(
                    f"{self.AGENT_URL}/{job_id}",
                    headers=self._headers(),
                )
                if response.status_code >= 400:
                    logger.warning("Agent poll failed: %s", response.text[:200])
                    return {}

                payload: dict[str, Any] = response.json()
                status = str(payload.get("status", "")).lower()
                if status == "completed":
                    credits = payload.get("creditsUsed") or payload.get("credits_used")
                    if credits is not None:
                        logger.info("Agent job %s completed — credits used: %s", job_id, credits)
                    return payload
                if status == "failed":
                    logger.warning(
                        "Agent job %s failed: %s",
                        job_id,
                        payload.get("error") or payload.get("message"),
                    )
                    return payload

                logger.debug("Agent job %s status: %s", job_id, status)
                time.sleep(interval)

        logger.warning("Agent job %s timed out after %ss", job_id, self._settings.firecrawl_agent_timeout_s)
        return {}

    @staticmethod
    def _parse_investigation(payload: dict[str, Any]) -> LeadInvestigationResult | None:
        if not payload:
            return None

        candidates: list[Any] = [payload.get("data"), payload]
        for candidate in candidates:
            if isinstance(candidate, dict):
                result = LeadInvestigationResult.from_api_payload(candidate)
                if result and (
                    result.has_rich_contacts()
                    or result.pitch_angle
                    or result.exterior_signals
                    or result.website_url
                    or result.source_urls
                ):
                    return result

        return LeadInvestigationResult.from_api_payload(payload.get("data") if payload else None)

    @staticmethod
    def dump_snapshot(path: Path, payload: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

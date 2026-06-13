from __future__ import annotations

import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

import httpx

from pallares_leads.enrich.contact_extract import candidate_paths
from pallares_leads.enrich.contact_requirements import (
    EnrichmentRules,
    investigation_meets_bar,
)
from pallares_leads.enrich.domain_verify import pick_verified_website_url, verify_website_url
from pallares_leads.enrich.firecrawl_types import FirecrawlStageMeta
from pallares_leads.enrich.google_gaps import is_corporate_locator_url
from pallares_leads.enrich.schema import (
    LEAD_CONTACT_SCHEMA,
    LEAD_INVESTIGATION_SCHEMA,
    LeadInvestigationResult,
    extract_prompt,
)
from pallares_leads.enrich.search_templates import load_search_templates, render_search_template
from pallares_leads.enrich.verify import GroundingResult, Rejection, ground_investigation
from pallares_leads.enrich.website_discover import candidate_website_urls, is_skipped_domain
from pallares_leads.progress import emit_rejection
from pallares_leads.schemas import RawLead
from pallares_leads.settings import Settings
from pallares_leads.utils.http_retry import request_with_retry

if TYPE_CHECKING:
    from pallares_leads.db.store import LeadStore

logger = logging.getLogger(__name__)
CONTACT_URL_HINTS = ("contact", "leasing", "management", "about", "team", "facilities")
BROKER_PDF_HINTS = ("showcase", "loopnet", "pearson", "cbre", "costar", "crexi", "flyer")
PDF_SNIPPET_MAX_CHARS = 3000
SKIP_URL_HINTS = ("maps.google.com", "google.com/maps", "mapquest.com", "goo.gl/maps")


class FirecrawlClient:
    BASE_URL = "https://api.firecrawl.dev/v1"
    TEAM_URL = "https://api.firecrawl.dev/v2"

    def __init__(self, settings: Settings, *, store: LeadStore | None = None) -> None:
        if not settings.firecrawl_api_key:
            raise ValueError("FIRECRAWL_API_KEY is required for enrichment")
        self._api_key = settings.firecrawl_api_key
        self._timeout_ms = settings.firecrawl_timeout_ms
        self._settings = settings
        self._store = store
        self._map_cache: dict[str, list[str]] = {}
        self.last_map_info: dict[str, Any] = {}
        self.last_scrape_target: str = ""
        self.last_search_info: dict[str, Any] = {}
        self.last_contact_search_info: dict[str, Any] = {}
        self.last_credits_used: int = 0
        self.session_credits_used: int = 0
        self._cost_run_id: str | None = None
        self._cost_place_id: str | None = None
        self._cost_request_id: str | None = None
        self.stage_meta: FirecrawlStageMeta = FirecrawlStageMeta()
        self.last_grounding: GroundingResult | None = None
        self.session_rejections: list[Rejection] = []
        self.session_markdown: dict[str, str] = {}  # url -> markdown fetched this lead

    def reset_session_credits(self) -> None:
        self.session_credits_used = 0
        self.last_credits_used = 0
        self.last_grounding = None
        self.session_rejections = []
        self.session_markdown = {}

    def set_cost_context(
        self,
        *,
        run_id: str | None = None,
        place_id: str | None = None,
        request_id: str | None = None,
    ) -> None:
        self._cost_run_id = run_id
        self._cost_place_id = place_id
        self._cost_request_id = request_id

    def _record_cost_event(self, credits: int, operation: str) -> None:
        if credits <= 0 or not self._store:
            return
        from pallares_leads.costs import load_pricing, usd_for

        pricing = load_pricing(self._settings.config_dir)
        cost_usd = usd_for(
            pricing,
            provider="firecrawl",
            operation=operation,
            units=credits,
            unit_type="credits",
        )
        self._store.record_cost_event(
            provider="firecrawl",
            operation=operation,
            units=credits,
            unit_type="credits",
            usd=cost_usd,
            run_id=self._cost_run_id,
            request_id=self._cost_request_id,
            place_id=self._cost_place_id,
        )
        self._store.commit_cost_events()

    @staticmethod
    def _metadata_candidates(payload: dict[str, Any]) -> list[Any]:
        """Collect metadata dicts from Firecrawl payloads (scrape vs search shapes differ)."""
        candidates: list[Any] = []
        data = payload.get("data")
        if isinstance(data, dict):
            candidates.append(data.get("metadata"))
        elif isinstance(data, list):
            for item in data:
                if isinstance(item, dict):
                    candidates.append(item.get("metadata"))
        candidates.append(payload.get("metadata"))
        return candidates

    @staticmethod
    def _credits_from_payload(payload: dict[str, Any], *, operation: str = "scrape") -> int:
        """Parse credits from Firecrawl response; fall back to known estimates."""
        for metadata in FirecrawlClient._metadata_candidates(payload):
            if not isinstance(metadata, dict):
                continue
            credits = metadata.get("creditsUsed", metadata.get("credits_used"))
            if credits is not None:
                try:
                    parsed = int(credits)
                    if parsed > 0:
                        return parsed
                except (TypeError, ValueError):
                    pass

        for key in ("creditsUsed", "credits_used"):
            credits = payload.get(key)
            if credits is not None:
                try:
                    parsed = int(credits)
                    if parsed > 0:
                        return parsed
                except (TypeError, ValueError):
                    pass

        # Firecrawl /search does not return credit counts — use published estimate.
        if (
            operation in ("search", "search_contact", "search_website")
            and payload.get("success") is not False
        ):
            return 2
        if operation == "map" and payload.get("success") is not False:
            return 1
        return 0

    def _track_credits(self, payload: dict[str, Any], *, operation: str = "scrape") -> int:
        credits = self._credits_from_payload(payload, operation=operation)
        self.last_credits_used = credits
        if credits > 0:
            self.session_credits_used += credits
            self._record_cost_event(credits, operation)
        return credits

    def _map_contact_search(self) -> str:
        templates = load_search_templates(self._settings.config_dir)
        return templates.get(
            "map_contact_search", "contact leasing management facilities about team"
        )

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
                payload = response.json()
                self._track_credits(payload)
                if response.status_code == 200 and payload.get("success") is not False:
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

        if self._store:
            db_cached = self._store.get_page_cache(
                cache_key,
                content_type="map_links",
                ttl_days=self._settings.page_cache_ttl_days,
            )
            if db_cached and db_cached.get("content"):
                try:
                    links = json.loads(str(db_cached["content"]))
                except json.JSONDecodeError:
                    links = []
                if isinstance(links, list):
                    self._map_cache[cache_key] = [str(u) for u in links]
                    self._set_stage_meta(
                        FirecrawlStageMeta(
                            stage="map",
                            website=website,
                            cached=True,
                            urls=links[:limit],
                            credits_est=0,
                        )
                    )
                    return [str(u) for u in links[:limit]]

        with httpx.Client(timeout=60.0) as client:
            response = request_with_retry(
                lambda: client.post(
                    f"{self.BASE_URL}/map",
                    headers=self._headers(),
                    json={
                        "url": website,
                        "search": self._map_contact_search(),
                        "limit": limit,
                    },
                ),
                label="Firecrawl map",
            )
            if response.status_code >= 400:
                logger.warning("Firecrawl map failed for %s: %s", website, response.text[:200])
                self._map_cache[cache_key] = []
                self._set_stage_meta(
                    FirecrawlStageMeta(
                        stage="map", website=website, cached=False, urls=[], credits_est=0
                    )
                )
                return []

            payload: dict[str, Any] = response.json()
            credits = self._track_credits(payload, operation="map")
            links = self._parse_map_links(payload)
            self._map_cache[cache_key] = links
            if self._store and links:
                self._store.set_page_cache(
                    cache_key,
                    content_type="map_links",
                    content=json.dumps(links),
                    credits_used=credits,
                )
            self._set_stage_meta(
                FirecrawlStageMeta(
                    stage="map",
                    website=website,
                    cached=False,
                    urls=links[:limit],
                    credits_est=credits or 1,
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
        if self._store:
            cached = self._store.get_page_cache(
                url,
                content_type="markdown",
                ttl_days=self._settings.page_cache_ttl_days,
            )
            if cached and cached.get("content"):
                self.last_credits_used = 0
                self.session_markdown[url] = str(cached["content"])
                return str(cached["content"])

        with httpx.Client(timeout=60.0) as client:
            response = request_with_retry(
                lambda: client.post(
                    f"{self.BASE_URL}/scrape",
                    headers=self._headers(),
                    json=self._scrape_body(url, formats=["markdown"]),
                ),
                label="Firecrawl scrape",
            )
            if response.status_code >= 400:
                logger.warning("Firecrawl scrape failed for %s: %s", url, response.text[:200])
                return None
            payload: dict[str, Any] = response.json()
            credits = self._track_credits(payload, operation="scrape")
            data = payload.get("data") or {}
            markdown = data.get("markdown")
            if isinstance(markdown, str) and markdown:
                self.session_markdown[url] = markdown
                if self._store:
                    self._store.set_page_cache(
                        url,
                        content_type="markdown",
                        content=markdown,
                        credits_used=credits,
                    )
            return markdown if isinstance(markdown, str) else None

    def scrape_pdf_snippet(self, url: str, *, max_pages: int = 15) -> str | None:
        """Extract markdown from a remote broker PDF via scrape+parsers."""
        if self._store:
            cached = self._store.get_page_cache(
                url,
                content_type="pdf_snippet",
                ttl_days=self._settings.page_cache_ttl_days,
            )
            if cached and cached.get("content"):
                self.last_credits_used = 0
                return str(cached["content"])

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
            response = request_with_retry(
                lambda: client.post(
                    f"{self.BASE_URL}/scrape",
                    headers=self._headers(),
                    json=body,
                ),
                label="Firecrawl PDF scrape",
            )
            if response.status_code >= 400:
                logger.warning("Firecrawl PDF scrape failed for %s: %s", url, response.text[:200])
                return None

            payload: dict[str, Any] = response.json()
            self._track_credits(payload, operation="scrape_pdf")
            data = payload.get("data") or {}
            markdown = data.get("markdown")
            if not isinstance(markdown, str) or not markdown.strip():
                return None

            snippet = markdown.strip()
            if len(snippet) > PDF_SNIPPET_MAX_CHARS:
                snippet = snippet[:PDF_SNIPPET_MAX_CHARS] + "\n…"
            if self._store:
                self._store.set_page_cache(
                    url,
                    content_type="pdf_snippet",
                    content=snippet,
                    credits_used=self.last_credits_used,
                )
            return snippet

    def scrape_site(self, website: str, *, max_pages: int = 4) -> list[tuple[str, str]]:
        urls = self._contact_urls_for_site(website, max_pages=max_pages)
        if not urls:
            return []

        outer = max(1, self._settings.enrichment_parallel_workers)
        per_client = max(1, self._settings.firecrawl_max_concurrency // outer)
        workers = min(len(urls), max_pages, per_client)
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

    def _ground_and_record(
        self,
        result: LeadInvestigationResult,
        page_text: str,
        *,
        url: str,
    ) -> LeadInvestigationResult | None:
        """Run the verification gate; never let ungrounded LLM output escape."""
        grounding = ground_investigation(result, page_text, source_label=url)
        self.last_grounding = grounding
        self.session_rejections.extend(grounding.rejections)

        for rejection in grounding.rejections:
            if self._cost_place_id:
                emit_rejection(
                    place_id=self._cost_place_id,
                    business="",
                    kind=rejection.kind,
                    value=rejection.value,
                    reason=rejection.reason,
                    context=rejection.context,
                )
        cleaned = grounding.result
        if not cleaned.site_contacts and not cleaned.has_usable_contact():
            if grounding.rejections:
                logger.info(
                    "  Verification gate: all extracted contacts rejected for %s (%d rejection(s))",
                    url,
                    len(grounding.rejections),
                )
            return cleaned if (cleaned.exterior_signals or cleaned.property_manager) else None
        return cleaned

    def _scrape_json(self, url: str, raw: RawLead) -> LeadInvestigationResult | None:
        cache_key_content = "json_grounded"
        if self._store:
            cached = self._store.get_page_cache(
                url,
                content_type=cache_key_content,
                ttl_days=self._settings.page_cache_ttl_days,
            )
            if cached and cached.get("content"):
                self.last_credits_used = 0
                try:
                    parsed = json.loads(str(cached["content"]))
                    if isinstance(parsed, dict):
                        # Cached content is post-gate: already grounded.
                        result = LeadInvestigationResult.from_api_payload(parsed)
                        if result:
                            return result
                except json.JSONDecodeError:
                    pass

        with httpx.Client(timeout=120.0) as client:
            response = request_with_retry(
                lambda: client.post(
                    f"{self.BASE_URL}/scrape",
                    headers=self._headers(),
                    json=self._scrape_body(
                        url,
                        formats=["markdown", "json"],
                        json_prompt=extract_prompt(raw),
                        contact_schema=True,
                    ),
                ),
                label="Firecrawl scrape+JSON",
            )
            if response.status_code >= 400:
                logger.warning(
                    "Firecrawl scrape+JSON failed for %s: %s",
                    url,
                    response.text[:300],
                )
                return None

            payload: dict[str, Any] = response.json()
            credits = self._track_credits(payload, operation="scrape_json")
            if payload.get("success") is False:
                logger.warning("Firecrawl scrape+JSON unsuccessful for %s", url)
                return None

            data = payload.get("data") or {}
            markdown = data.get("markdown")
            page_text = markdown if isinstance(markdown, str) else ""
            if page_text:
                self.session_markdown[url] = page_text
                if self._store:
                    self._store.set_page_cache(
                        url,
                        content_type="markdown",
                        content=page_text,
                        credits_used=0,
                    )

            json_blob = data.get("json")
            if isinstance(json_blob, str):
                try:
                    json_blob = json.loads(json_blob)
                except json.JSONDecodeError:
                    json_blob = None
            if not isinstance(json_blob, dict):
                logger.warning("Firecrawl scrape+JSON returned no parseable json blob for %s", url)
                return None

            result = LeadInvestigationResult.from_api_payload(json_blob)
            if not result:
                return None
            grounded = self._ground_and_record(result, page_text, url=url)
            if grounded and self._store:
                self._store.set_page_cache(
                    url,
                    content_type=cache_key_content,
                    content=grounded.model_dump_json(),
                    credits_used=credits,
                )
            return grounded

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

        query = render_search_template(
            "website_discovery",
            config_dir=self._settings.config_dir,
            business_name=raw.business_name,
            city=raw.city,
            state=raw.state,
        )
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
            self._track_credits(payload, operation="search")
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

    def search_contact_gap(
        self,
        raw: RawLead,
        rules: EnrichmentRules,
    ) -> LeadInvestigationResult | None:
        """Tier 2: Firecrawl Search + scrape+JSON (~6 credits) when Tier 1 misses contact bar."""
        queries: list[str] = []
        if raw.website and is_corporate_locator_url(raw.website):
            host = urlparse(raw.website).netloc.replace("www.", "")
            queries.append(
                render_search_template(
                    "contact_gap_corporate",
                    config_dir=self._settings.config_dir,
                    host=host,
                    city=raw.city,
                    state=raw.state,
                    business_name=raw.business_name,
                )
            )
        queries.append(
            render_search_template(
                "contact_gap_local",
                config_dir=self._settings.config_dir,
                business_name=raw.business_name,
                city=raw.city,
                state=raw.state,
                host="",
            )
        )

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
                self._track_credits(payload, operation="search_contact")
                for item in payload.get("data") or []:
                    if not isinstance(item, dict):
                        continue
                    url = item.get("url") or (item.get("metadata") or {}).get("sourceURL")
                    if not isinstance(url, str) or not url:
                        continue
                    lower = url.lower()
                    if any(hint in lower for hint in SKIP_URL_HINTS):
                        continue
                    if is_skipped_domain(url):
                        continue
                    if url not in candidates:
                        candidates.append(url)

        if self._store:
            self._store.commit_cost_events()

        self.last_contact_search_info = {
            "query": last_query,
            "candidates": candidates[:6],
        }

        for url in candidates[:3]:
            logger.info("  Tier 2 search+JSON: %s", url)
            result = self._scrape_json(url, raw)
            if (
                result
                and investigation_meets_bar(result, rules, property_type=raw.property_type)[0]
            ):
                self.last_contact_search_info["matched_url"] = url
                return result

        return None

    def search_web(self, query: str, *, limit: int = 5) -> list[dict[str, str]]:
        """Firecrawl web search returning url/title snippets."""
        results: list[dict[str, str]] = []
        with httpx.Client(timeout=60.0) as client:
            response = client.post(
                f"{self.BASE_URL}/search",
                headers=self._headers(),
                json={"query": query, "limit": limit},
            )
            if response.status_code >= 400:
                logger.warning("Firecrawl search failed for %r: %s", query, response.text[:200])
                return results
            payload: dict[str, Any] = response.json()
            self._track_credits(payload)
            for item in payload.get("data") or []:
                if not isinstance(item, dict):
                    continue
                url = item.get("url") or (item.get("metadata") or {}).get("sourceURL")
                if not isinstance(url, str) or not url:
                    continue
                title = str(item.get("title") or item.get("description") or "")
                results.append({"url": url, "title": title})
        return results

    @staticmethod
    def _unwrap_api_data(payload: dict[str, Any]) -> dict[str, Any]:
        data = payload.get("data")
        if isinstance(data, dict):
            return data
        return payload

    @staticmethod
    def normalize_team_credit_usage(payload: dict[str, Any]) -> dict[str, Any]:
        """Normalize Firecrawl v1/v2 team credit-usage payloads to top-level keys."""
        if payload.get("error"):
            return payload

        data = FirecrawlClient._unwrap_api_data(payload)
        remaining = data.get("remainingCredits", data.get("remaining_credits"))
        used = data.get("usedCredits", data.get("used_credits"))
        plan = data.get("planCredits", data.get("plan_credits"))

        if used is None and remaining is not None and plan is not None:
            try:
                used = float(plan) - float(remaining)
            except (TypeError, ValueError):
                used = None

        normalized = dict(payload)
        if remaining is not None:
            normalized["remainingCredits"] = remaining
            normalized["remaining_credits"] = remaining
        if used is not None:
            normalized["usedCredits"] = used
            normalized["used_credits"] = used
        if plan is not None:
            normalized["planCredits"] = plan
            normalized["plan_credits"] = plan
        billing_end = data.get("billingPeriodEnd", data.get("billing_period_end"))
        if billing_end is not None:
            normalized["billingPeriodEnd"] = billing_end
        return normalized

    def get_team_credit_usage(self) -> dict[str, Any]:
        """Fetch remaining team credits from Firecrawl v2 API."""
        with httpx.Client(timeout=30.0) as client:
            response = client.get(
                f"{self.TEAM_URL}/team/credit-usage",
                headers=self._headers(),
            )
            if response.status_code >= 400:
                logger.warning(
                    "Firecrawl credit-usage failed: HTTP %s %s",
                    response.status_code,
                    response.text[:200],
                )
                return {"error": response.text[:200], "status_code": response.status_code}
            payload = self.normalize_team_credit_usage(response.json())
            if self._store:
                remaining = payload.get("remainingCredits", payload.get("remaining_credits"))
                used = payload.get("usedCredits", payload.get("used_credits"))
                try:
                    self._store.record_credit_snapshot(
                        provider="firecrawl",
                        remaining_credits=float(remaining) if remaining is not None else None,
                        used_credits=float(used) if used is not None else None,
                        snapshot=payload,
                    )
                except (TypeError, ValueError):
                    self._store.record_credit_snapshot(provider="firecrawl", snapshot=payload)
            return payload

    @staticmethod
    def dump_snapshot(path: Path, payload: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

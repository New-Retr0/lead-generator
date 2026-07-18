from __future__ import annotations

import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError, as_completed
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

import httpx
from firecrawl import Firecrawl
from firecrawl.v2.types import JsonFormat, ScrapeOptions
from firecrawl.v2.utils.error_handler import PaymentRequiredError, RateLimitError

from pallares_leads.db.raw_archive import record_capture
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
    LeadInvestigationResult,
    extract_prompt,
)
from pallares_leads.enrich.search_templates import load_search_templates, render_search_template
from pallares_leads.enrich.task_templates import SOS_BIZFILE_TASK, render_task
from pallares_leads.enrich.verify import GroundingResult, Rejection, ground_investigation
from pallares_leads.enrich.website_discover import candidate_website_urls, is_skipped_domain
from pallares_leads.progress import emit_rejection
from pallares_leads.schemas import RawLead
from pallares_leads.settings import Settings
from pallares_leads.utils.http_retry import (
    OutOfCreditsError,
    circuit_is_open,
    request_with_retry,
)

if TYPE_CHECKING:
    from pallares_leads.db.store import LeadStore

logger = logging.getLogger(__name__)
CONTACT_URL_HINTS = (
    "contact",
    "leasing",
    "management",
    "about",
    "team",
    "facilities",
    "portfolio",
    "properties",
)
BROKER_PDF_HINTS = ("showcase", "loopnet", "pearson", "cbre", "costar", "crexi", "flyer")
PDF_SNIPPET_MAX_CHARS = 3000
SKIP_URL_HINTS = ("maps.google.com", "google.com/maps", "mapquest.com", "goo.gl/maps")

EXCLUDE_SEARCH_DOMAINS = [
    "facebook.com",
    "instagram.com",
    "yelp.com",
    "yellowpages.com",
    "mapquest.com",
    "linkedin.com",
]
DEAD_END_MARKERS = (
    "page not found",
    "404 not found",
    "access denied",
    "just a moment",
    "enable javascript",
    "captcha",
    "are you a robot",
)
MULTI_TENANT_MAP_TYPES = frozenset(
    {
        "strip_mall",
        "shopping_center",
        "hotel",
        "hoa",
        "property_manager",
        "medical_plaza",
        "industrial",
        "parking_large_private",
    }
)

# Shared across parallel enrichment workers (one map credit per site per process).
_SHARED_MAP_CACHE: dict[str, list[str]] = {}
_MAP_CACHE_LOCK = threading.Lock()


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
        # SDK defaults timeout=None → requests hang forever on stalled sockets.
        # Keep transport timeout above the per-scrape API budget.
        self._http_timeout_s = max(45.0, (self._timeout_ms / 1000.0) + 15.0)
        self._sdk = Firecrawl(api_key=self._api_key, timeout=self._http_timeout_s)
        self.last_map_info: dict[str, Any] = {}
        self.last_scrape_target: str = ""
        self.last_search_info: dict[str, Any] = {}
        self.last_contact_search_info: dict[str, Any] = {}
        self.last_credits_used: int = 0
        self.last_credits_source: str = "none"  # reported | estimated | none
        self.last_credits_estimated: int | None = None
        self.last_credits_reported: int | None = None
        self.session_credits_used: int = 0
        self._cost_run_id: str | None = None
        self._cost_place_id: str | None = None
        self._cost_request_id: str | None = None
        self._cost_stage: str | None = None
        self._last_op_duration_ms: int | None = None
        self._pending_credit_meta: dict[str, Any] = {}
        self._plan_max_concurrency: int | None = None
        self._resolved_concurrency: int | None = None
        self.stage_meta: FirecrawlStageMeta = FirecrawlStageMeta()
        self.last_grounding: GroundingResult | None = None
        self.session_rejections: list[Rejection] = []
        self.session_markdown: dict[str, str] = {}  # url -> markdown fetched this lead
        self.grounding_storm: bool = False
        self.dead_ends: list[str] = []

    def reset_session_credits(self) -> None:
        self.session_credits_used = 0
        self.last_credits_used = 0
        self.last_credits_source = "none"
        self.last_credits_estimated = None
        self.last_credits_reported = None
        self._pending_credit_meta = {}
        self.last_grounding = None
        self.session_rejections = []
        self.session_markdown = {}
        self.grounding_storm = False
        self.dead_ends = []

    def should_stop_expensive_stages(self) -> bool:
        return (
            self.grounding_storm
            or circuit_is_open("Firecrawl scrape")
            or circuit_is_open("Firecrawl map")
        )

    @staticmethod
    def is_dead_end_markdown(markdown: str | None) -> bool:
        if not markdown or not markdown.strip():
            return True
        if len(markdown.strip()) < 20:
            return True
        lower = markdown.lower()
        return any(marker in lower for marker in DEAD_END_MARKERS)

    def _archive_response(
        self,
        operation: str,
        *,
        request: dict[str, Any] | None = None,
        response: Any = None,
    ) -> None:
        if response is None:
            return
        payload: Any = response
        if hasattr(response, "model_dump"):
            payload = response.model_dump(mode="json")
        elif hasattr(response, "__dict__") and not isinstance(response, (dict, list, str, int)):
            payload = {
                k: v
                for k, v in response.__dict__.items()
                if not k.startswith("_")
                and isinstance(v, (str, int, float, bool, list, dict, type(None)))
            }
        record_capture(
            self._settings,
            "firecrawl",
            operation,
            place_id=self._cost_place_id,
            run_id=self._cost_run_id,
            request=request,
            response=payload,
            duration_ms=self._last_op_duration_ms,
        )

    def set_cost_context(
        self,
        *,
        run_id: str | None = None,
        place_id: str | None = None,
        request_id: str | None = None,
        stage: str | None = None,
    ) -> None:
        if run_id is not None:
            self._cost_run_id = run_id
        if place_id is not None:
            self._cost_place_id = place_id
        if request_id is not None:
            self._cost_request_id = request_id
        if stage is not None:
            self._cost_stage = stage

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
        meta: dict[str, Any] = dict(self._pending_credit_meta)
        self._pending_credit_meta = {}
        if self._cost_stage:
            meta["stage"] = self._cost_stage
        if self._last_op_duration_ms is not None:
            meta["duration_ms"] = self._last_op_duration_ms
        if self.last_credits_source != "none":
            meta["credits_source"] = self.last_credits_source
        if self.last_credits_reported is not None:
            meta["credits_reported"] = self.last_credits_reported
        if self.last_credits_estimated is not None:
            meta["credits_estimated"] = self.last_credits_estimated
        self._store.record_cost_event(
            provider="firecrawl",
            operation=operation,
            units=credits,
            unit_type="credits",
            usd=cost_usd,
            run_id=self._cost_run_id,
            request_id=self._cost_request_id,
            place_id=self._cost_place_id,
            meta=meta or None,
        )
        self._store.commit_cost_events()
        self._last_op_duration_ms = None

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
    def _estimated_credits_for_operation(operation: str) -> int:
        if operation in (
            "search",
            "search_contact",
            "search_website",
            "search_news",
        ):
            return 2
        if operation in ("map", "change_tracking", "scrape"):
            return 1
        if operation == "scrape_json":
            return 5
        return 0

    @staticmethod
    def _parse_reported_credits(payload: dict[str, Any]) -> int | None:
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
        return None

    @staticmethod
    def _credits_from_payload(payload: dict[str, Any], *, operation: str = "scrape") -> int:
        """Parse credits from Firecrawl response; fall back to known estimates."""
        reported = FirecrawlClient._parse_reported_credits(payload)
        if reported is not None:
            return reported
        if payload.get("success") is False:
            return 0
        return FirecrawlClient._estimated_credits_for_operation(operation)

    def _remember_credit_breakdown(
        self,
        *,
        billed: int,
        reported: int | None,
        estimated: int | None,
        source: str,
    ) -> None:
        self.last_credits_used = billed
        self.last_credits_reported = reported
        self.last_credits_estimated = estimated
        self.last_credits_source = source

    def _track_credits(self, payload: dict[str, Any], *, operation: str = "scrape") -> int:
        reported = self._parse_reported_credits(payload)
        estimated = self._estimated_credits_for_operation(operation)
        if reported is not None:
            credits = reported
            source = "reported"
        elif payload.get("success") is False:
            credits = 0
            source = "none"
        else:
            credits = estimated
            source = "estimated" if credits > 0 else "none"
        self._remember_credit_breakdown(
            billed=credits,
            reported=reported,
            estimated=estimated if estimated > 0 else None,
            source=source,
        )
        if credits > 0:
            self.session_credits_used += credits
            self._record_cost_event(credits, operation)
        return credits

    def _track_credits_units(
        self,
        credits: int,
        operation: str,
        *,
        reported: int | None = None,
        estimated: int | None = None,
        source: str | None = None,
    ) -> int:
        est = estimated if estimated is not None else self._estimated_credits_for_operation(operation)
        if source is None:
            if reported is not None:
                source = "reported"
            elif credits > 0 and credits == est:
                source = "estimated"
            elif credits > 0:
                source = "reported"
            else:
                source = "none"
        self._remember_credit_breakdown(
            billed=credits,
            reported=reported,
            estimated=est if est > 0 else None,
            source=source,
        )
        if credits > 0:
            self.session_credits_used += credits
            self._record_cost_event(credits, operation)
        return credits

    @staticmethod
    def _credits_from_document(doc: Any) -> int | None:
        """Return reported credits from an SDK document, or None if absent."""
        if doc is None:
            return None
        for attr in ("credits_used", "creditsUsed"):
            val = getattr(doc, attr, None)
            if val is not None:
                try:
                    parsed = int(val)
                    if parsed > 0:
                        return parsed
                except (TypeError, ValueError):
                    pass
        metadata = getattr(doc, "metadata", None)
        if metadata is not None:
            for attr in ("credits_used", "creditsUsed"):
                val = getattr(metadata, attr, None)
                if val is not None:
                    try:
                        parsed = int(val)
                        if parsed > 0:
                            return parsed
                    except (TypeError, ValueError):
                        pass
            if isinstance(metadata, dict):
                for key in ("credits_used", "creditsUsed"):
                    val = metadata.get(key)
                    if val is not None:
                        try:
                            parsed = int(val)
                            if parsed > 0:
                                return parsed
                        except (TypeError, ValueError):
                            pass
        return None

    def _sdk_call_with_retry(self, fn, *, label: str, operation: str):
        """Run an SDK call with retry on rate limits; map 402 to OutOfCreditsError.

        Agent jobs already wait up to ``firecrawl_agent_timeout_s`` internally — do not
        restart them on 429 (3×180s would pin a worker near the lead budget).
        """
        max_attempts = 1 if operation == "agent" else 3
        last_exc: Exception | None = None
        for attempt in range(1, max_attempts + 1):
            started = time.perf_counter()
            try:
                result = fn()
                self._last_op_duration_ms = int((time.perf_counter() - started) * 1000)
                reported = self._credits_from_document(result)
                estimated = self._estimated_credits_for_operation(operation)
                if reported is not None:
                    credits = reported
                    source = "reported"
                elif estimated > 0:
                    credits = estimated
                    source = "estimated"
                else:
                    # Unknown op with no report — bill 1 as conservative scrape default.
                    credits = 1
                    source = "estimated"
                    estimated = 1
                self._track_credits_units(
                    credits,
                    operation,
                    reported=reported,
                    estimated=estimated if estimated > 0 else None,
                    source=source,
                )
                self._archive_response(operation, response=result)
                self.note_rate_limit_recovered()
                return result
            except PaymentRequiredError as exc:
                raise OutOfCreditsError(str(exc)) from exc
            except RateLimitError as exc:
                last_exc = exc
                self.note_rate_limit()
                if attempt >= max_attempts:
                    raise
                delay = float(2 ** (attempt - 1))
                logger.warning(
                    "%s rate-limited — retry %d/%d in %.1fs",
                    label,
                    attempt,
                    max_attempts,
                    delay,
                )
                time.sleep(delay)
        if last_exc:
            raise last_exc
        raise RuntimeError(f"{label} failed after retries")

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
        with _MAP_CACHE_LOCK:
            _SHARED_MAP_CACHE.clear()

    @staticmethod
    def _filter_contact_links(links: list[str]) -> list[str]:
        filtered: list[str] = []
        seen: set[str] = set()
        for url in links:
            key = url.split("#")[0].rstrip("/")
            if key in seen:
                continue
            lower = key.lower()
            if any(hint in lower for hint in CONTACT_URL_HINTS):
                seen.add(key)
                filtered.append(url)
        return filtered

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

    def _scrape_kwargs(self) -> dict[str, Any]:
        kwargs: dict[str, Any] = {
            "only_main_content": True,
            "timeout": self._timeout_ms,
        }
        if self._settings.firecrawl_scrape_max_age_ms > 0:
            kwargs["max_age"] = self._settings.firecrawl_scrape_max_age_ms
        return kwargs

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

    def map_contact_urls(
        self, website: str, *, limit: int = 10, property_type: str = ""
    ) -> list[str]:
        """Discover contact/leasing pages on a known domain (1 credit per call)."""
        if property_type in MULTI_TENANT_MAP_TYPES:
            limit = max(limit, 25)
        cache_key = self._site_cache_key(website)
        with _MAP_CACHE_LOCK:
            if cache_key in _SHARED_MAP_CACHE:
                cached = _SHARED_MAP_CACHE[cache_key]
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
                    parsed = [str(u) for u in links]
                    with _MAP_CACHE_LOCK:
                        _SHARED_MAP_CACHE[cache_key] = parsed
                    self._set_stage_meta(
                        FirecrawlStageMeta(
                            stage="map",
                            website=website,
                            cached=True,
                            urls=parsed[:limit],
                            credits_est=0,
                        )
                    )
                    return parsed[:limit]

        try:
            def _do_map(**extra: Any):
                return self._sdk.map(
                    website,
                    search=self._map_contact_search(),
                    limit=limit,
                    **extra,
                )

            try:
                map_data = self._sdk_call_with_retry(
                    lambda: _do_map(include_subdomains=True, sitemap="include"),
                    label="Firecrawl map",
                    operation="map",
                )
            except TypeError:
                map_data = self._sdk_call_with_retry(
                    lambda: _do_map(),
                    label="Firecrawl map",
                    operation="map",
                )
        except OutOfCreditsError:
            raise
        except Exception as exc:
            logger.warning("Firecrawl map failed for %s: %s", website, exc)
            with _MAP_CACHE_LOCK:
                _SHARED_MAP_CACHE[cache_key] = []
            self._set_stage_meta(
                FirecrawlStageMeta(
                    stage="map", website=website, cached=False, urls=[], credits_est=0
                )
            )
            return []

        links = [link.url for link in (map_data.links or []) if getattr(link, "url", None)]
        credits = self.last_credits_used or 1
        with _MAP_CACHE_LOCK:
            _SHARED_MAP_CACHE[cache_key] = links
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
                credits_est=credits,
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

    def scrape_url(self, url: str, *, formats: list[str] | None = None) -> str | None:
        scrape_formats = formats or ["markdown"]
        if self._store and scrape_formats == ["markdown"]:
            cached = self._store.get_page_cache(
                url,
                content_type="markdown",
                ttl_days=self._settings.page_cache_ttl_days,
            )
            if cached and cached.get("content"):
                self.last_credits_used = 0
                self.session_markdown[url] = str(cached["content"])
                return str(cached["content"])

        try:
            doc = self._sdk_call_with_retry(
                lambda: self._sdk.scrape(url, formats=scrape_formats, **self._scrape_kwargs()),
                label="Firecrawl scrape",
                operation="scrape",
            )
        except OutOfCreditsError:
            raise
        except Exception as exc:
            logger.warning("Firecrawl scrape failed for %s: %s", url, exc)
            return None

        markdown = getattr(doc, "markdown", None) if doc else None
        if isinstance(markdown, str) and markdown:
            self.session_markdown[url] = markdown
            if self._store and scrape_formats == ["markdown"]:
                self._store.set_page_cache(
                    url,
                    content_type="markdown",
                    content=markdown,
                    credits_used=self.last_credits_used,
                )
            links = getattr(doc, "links", None)
            if links and scrape_formats != ["markdown"]:
                with _MAP_CACHE_LOCK:
                    site_key = self._site_cache_key(url)
                    existing = _SHARED_MAP_CACHE.get(site_key, [])
                    merged = list(dict.fromkeys([*existing, *[str(u) for u in links if u]]))
                    _SHARED_MAP_CACHE[site_key] = merged
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
            started = time.perf_counter()
            response = request_with_retry(
                lambda: client.post(
                    f"{self.BASE_URL}/scrape",
                    headers=self._headers(),
                    json=body,
                ),
                label="Firecrawl PDF scrape",
            )
            self._last_op_duration_ms = int((time.perf_counter() - started) * 1000)
            if response.status_code >= 400:
                logger.warning("Firecrawl PDF scrape failed for %s: %s", url, response.text[:200])
                return None

            payload: dict[str, Any] = response.json()
            self._archive_response("scrape_pdf", request={"url": url}, response=payload)
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


    def batch_scrape_urls(
        self,
        urls: list[str],
        *,
        formats: list[str] | None = None,
    ) -> list[tuple[str, str]]:
        """Batch-scrape mapped URLs (same credits, less request waste than ThreadPool)."""
        if not urls or self.should_stop_expensive_stages():
            return []
        formats = formats or ["markdown"]
        # SDK wait_timeout defaults to None → polls forever if the job stalls.
        wait_timeout_s = max(
            60,
            min(
                max(60, int(self._settings.enrichment_lead_timeout_s) - 30),
                len(urls) * max(30, self._timeout_ms // 1000) + 60,
            ),
        )
        try:
            # Firecrawl SDK may expose start_batch_scrape / batch_scrape; fall back to HTTP v1.
            if hasattr(self._sdk, "batch_scrape"):
                result = self._sdk_call_with_retry(
                    lambda: self._sdk.batch_scrape(
                        urls,
                        formats=formats,
                        wait_timeout=wait_timeout_s,
                        **self._scrape_kwargs(),
                    ),
                    label="Firecrawl batch scrape",
                    operation="batch_scrape",
                )
                pages: list[tuple[str, str]] = []
                data = getattr(result, "data", None) or getattr(result, "documents", None) or []
                if hasattr(result, "model_dump"):
                    dumped = result.model_dump(mode="json")
                    data = dumped.get("data") or dumped.get("documents") or data
                for item in data or []:
                    if isinstance(item, dict):
                        meta = item.get("metadata") or {}
                        url = str(meta.get("sourceURL") or meta.get("url") or item.get("url") or "")
                        markdown = item.get("markdown")
                    else:
                        url = str(getattr(item, "url", "") or getattr(getattr(item, "metadata", None), "source_url", "") or "")
                        markdown = getattr(item, "markdown", None)
                    if not url or not isinstance(markdown, str) or not markdown.strip():
                        continue
                    if self.is_dead_end_markdown(markdown):
                        self.dead_ends.append(url)
                        continue
                    self.session_markdown[url] = markdown
                    pages.append((url, markdown))
                return pages
        except Exception as exc:
            logger.debug("SDK batch scrape unavailable: %s", exc)

        # HTTP fallback (v1 batch/scrape)
        body: dict[str, Any] = {
            "urls": urls,
            "formats": formats,
            "onlyMainContent": True,
            "timeout": self._timeout_ms,
        }
        if self._settings.firecrawl_scrape_max_age_ms > 0:
            body["maxAge"] = self._settings.firecrawl_scrape_max_age_ms
        with httpx.Client(timeout=180.0) as client:
            response = request_with_retry(
                lambda: client.post(
                    f"{self.BASE_URL}/batch/scrape",
                    headers={"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"},
                    json=body,
                ),
                label="Firecrawl batch scrape",
                circuit_cooldown_s=self._settings.firecrawl_429_circuit_cooldown_s,
            )
            if response.status_code >= 400:
                logger.warning("Firecrawl batch scrape failed: %s", response.text[:200])
                return []
            payload = response.json()
            if not isinstance(payload, dict):
                return []
            self._track_credits(payload, operation="batch_scrape")
        pages = []
        data = payload.get("data")
        items = data if isinstance(data, list) else []
        for item in items:
            if not isinstance(item, dict):
                continue
            meta = item.get("metadata") or {}
            url = str(meta.get("sourceURL") or meta.get("url") or item.get("url") or "")
            markdown = item.get("markdown")
            if not url or not isinstance(markdown, str) or not markdown.strip():
                continue
            if self.is_dead_end_markdown(markdown):
                self.dead_ends.append(url)
                continue
            self.session_markdown[url] = markdown
            if self._store:
                self._store.set_page_cache(
                    url, content_type="markdown", content=markdown, credits_used=0
                )
            pages.append((url, markdown))
        return pages

    def scrape_site(self, website: str, *, max_pages: int = 4) -> list[tuple[str, str]]:
        if self.should_stop_expensive_stages():
            return []
        urls = self._contact_urls_for_site(website, max_pages=max_pages)
        if not urls:
            return []

        if len(urls) > 1:
            try:
                batched = self.batch_scrape_urls(urls[:max_pages])
            except Exception as exc:
                logger.debug("Batch scrape unavailable, using parallel scrape: %s", exc)
                batched = []
            if batched:
                return batched

        outer = max(1, self.effective_parallel_workers())
        per_client = max(1, self.effective_max_concurrency() // outer)
        workers = min(len(urls), max_pages, per_client)
        if workers <= 1:
            pages: list[tuple[str, str]] = []
            for url in urls:
                markdown = self.scrape_url(url)
                if markdown and not self.is_dead_end_markdown(markdown):
                    pages.append((url, markdown))
                elif markdown:
                    self.dead_ends.append(url)
            return pages

        by_url: dict[str, str] = {}
        # Bound wall-clock wait: SDK HTTP timeout × retry budget, not unbounded as_completed.
        scrape_budget_s = max(
            90,
            min(
                max(90, int(self._settings.enrichment_lead_timeout_s) // 2),
                int(self._http_timeout_s) * 3 + 60,
            ),
        )
        # Do not use `with ThreadPoolExecutor`: on timeout its __exit__ calls
        # shutdown(wait=True) and re-blocks on zombie scrape threads.
        pool = ThreadPoolExecutor(max_workers=workers)
        futures = {pool.submit(self.scrape_url, url): url for url in urls}
        try:
            try:
                for future in as_completed(futures, timeout=scrape_budget_s):
                    url = futures[future]
                    try:
                        markdown = future.result(timeout=1)
                    except Exception as exc:
                        logger.warning("Parallel scrape failed for %s: %s", url, exc)
                        continue
                    if markdown and not self.is_dead_end_markdown(markdown):
                        by_url[url] = markdown
                    elif markdown:
                        self.dead_ends.append(url)
            except FuturesTimeoutError:
                logger.warning(
                    "Parallel scrape_site timed out after %ss (%d/%d urls)",
                    scrape_budget_s,
                    len(by_url),
                    len(urls),
                )
        finally:
            pool.shutdown(wait=False, cancel_futures=True)

        return [(url, by_url[url]) for url in urls if url in by_url]

    def scrape_lead(self, raw: RawLead) -> LeadInvestigationResult | None:
        """Tier-1: homepage links when available, else map; then scrape+JSON extract."""
        if not raw.website:
            return None
        if self.should_stop_expensive_stages():
            return None

        self.set_cost_context(stage="map")
        mapped: list[str] = []
        homepage_doc = None
        try:
            homepage_doc = self._sdk_call_with_retry(
                lambda: self._sdk.scrape(
                    raw.website,
                    formats=["markdown", "links"],
                    **self._scrape_kwargs(),
                ),
                label="Firecrawl homepage scrape",
                operation="scrape",
            )
        except OutOfCreditsError:
            raise
        except Exception as exc:
            logger.warning("Homepage scrape failed for %s: %s", raw.website, exc)

        if homepage_doc:
            link_urls = [str(u) for u in (homepage_doc.links or []) if u]
            contact_links = self._filter_contact_links(link_urls)
            if contact_links:
                mapped = contact_links
                cache_key = self._site_cache_key(raw.website)
                with _MAP_CACHE_LOCK:
                    _SHARED_MAP_CACHE[cache_key] = link_urls
                self._set_stage_meta(
                    FirecrawlStageMeta(
                        stage="map",
                        website=raw.website,
                        cached=True,
                        urls=contact_links,
                        credits_est=0,
                    )
                )
            if isinstance(homepage_doc.markdown, str) and homepage_doc.markdown:
                self.session_markdown[raw.website] = homepage_doc.markdown

        if not mapped:
            mapped = self.map_contact_urls(raw.website, limit=8)

        self.set_cost_context(stage="scrape")
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
        storm_limit = self._settings.firecrawl_grounding_storm_limit
        if storm_limit > 0 and len(self.session_rejections) >= storm_limit:
            self.grounding_storm = True
            logger.warning(
                "  Grounding storm — %d rejections this lead; pausing expensive Firecrawl stages",
                len(self.session_rejections),
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
        """Tier-1 structured extraction via Firecrawl scrape+JSON."""
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
                        result = LeadInvestigationResult.from_api_payload(parsed)
                        if result:
                            return result
                except json.JSONDecodeError:
                    pass

        formats: list[Any] = [
            "markdown",
            JsonFormat(
                type="json",
                prompt=extract_prompt(raw),
                schema=LEAD_CONTACT_SCHEMA,
            ),
        ]
        try:
            doc = self._sdk_call_with_retry(
                lambda: self._sdk.scrape(url, formats=formats, **self._scrape_kwargs()),
                label="Firecrawl scrape+JSON",
                operation="scrape_json",
            )
        except OutOfCreditsError:
            raise
        except Exception as exc:
            logger.warning("Firecrawl scrape+JSON failed for %s: %s", url, exc)
            return None

        if doc is None:
            return None

        page_text = getattr(doc, "markdown", None) or ""
        if isinstance(page_text, str) and page_text.strip():
            self.session_markdown[url] = page_text
            if self._store:
                self._store.set_page_cache(
                    url,
                    content_type="markdown",
                    content=page_text,
                    credits_used=0,
                )

        json_blob = getattr(doc, "json", None)
        if isinstance(json_blob, str):
            try:
                json_blob = json.loads(json_blob)
            except json.JSONDecodeError:
                json_blob = None
        if not isinstance(json_blob, dict):
            logger.warning("Firecrawl scrape+JSON returned no parseable json for %s", url)
            return None

        result = LeadInvestigationResult.from_api_payload(json_blob)
        if not result:
            return None
        grounded = self._ground_and_record(result, page_text if isinstance(page_text, str) else "", url=url)
        if grounded and self._store:
            self._store.set_page_cache(
                url,
                content_type=cache_key_content,
                content=grounded.model_dump_json(),
                credits_used=self.last_credits_used,
            )
        return grounded

    def _search_items(
        self,
        search_data: Any,
        *,
        include_news: bool = False,
    ) -> list[tuple[str, str, str]]:
        """Flatten SDK search results to (url, title, markdown) tuples."""
        rows: list[tuple[str, str, str]] = []
        groups: list[Any] = [getattr(search_data, "web", None)]
        if include_news:
            groups.append(getattr(search_data, "news", None))
        for group in groups:
            if not group:
                continue
            for item in group:
                url = getattr(item, "url", None) or ""
                if not url and hasattr(item, "metadata_dict"):
                    url = item.metadata_dict.get("sourceURL") or item.metadata_dict.get("url") or ""
                title = getattr(item, "title", None) or getattr(item, "description", None) or ""
                markdown = getattr(item, "markdown", None) or getattr(item, "snippet", None) or ""
                if url:
                    rows.append((str(url), str(title or ""), str(markdown or "")))
        return rows

    def _sdk_search(self, query: str, *, operation: str = "search", **kwargs: Any):
        search_kwargs = dict(kwargs)
        search_kwargs.setdefault("ignore_invalid_urls", True)
        recency = (self._settings.firecrawl_search_recency or "").strip()
        if recency and "tbs" not in search_kwargs:
            search_kwargs["tbs"] = recency
        return self._sdk_call_with_retry(
            lambda: self._sdk.search(query, **search_kwargs),
            label=f"Firecrawl {operation}",
            operation=operation,
        )

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
        candidates: list[str] = []
        try:
            search_data = self._sdk_search(
                query,
                operation="search",
                limit=8,
                location=f"{raw.city},{raw.state},United States",
            )
        except OutOfCreditsError:
            raise
        except Exception as exc:
            logger.warning("Firecrawl search failed for %s: %s", raw.business_name, exc)
            self.last_search_info = {
                "query": query,
                "method": "search_api",
                "found": None,
                "error": str(exc)[:200],
            }
            return None

        for url, _title, _md in self._search_items(search_data):
            if url and not is_skipped_domain(url):
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
        """Tier 2: v2 search with scrapeOptions + domain/location filters + scrape+JSON."""
        if self.should_stop_expensive_stages():
            return None
        self.set_cost_context(stage="tier2_search")
        queries: list[str] = []
        include_domains: list[str] = []
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
        elif raw.website:
            host = urlparse(raw.website).netloc.replace("www.", "")
            if host:
                include_domains.append(host)

        role_template = "contact_gap_facilities"
        if raw.property_type == "property_manager":
            role_template = "contact_gap_pm"
        elif raw.property_type in MULTI_TENANT_MAP_TYPES:
            role_template = "contact_gap_owner"
        queries.append(
            render_search_template(
                role_template,
                config_dir=self._settings.config_dir,
                business_name=raw.business_name,
                city=raw.city,
                state=raw.state,
                host="",
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

        location = f"{raw.city},{raw.state},United States"
        scrape_opts = ScrapeOptions(
            formats=["markdown"],
            only_main_content=True,
            timeout=self._timeout_ms,
        )
        last_query = ""
        collected: list[tuple[str, str]] = []

        for query in queries[:2]:
            last_query = query
            search_kwargs: dict[str, Any] = {
                "operation": "search_contact",
                "limit": 6,
                "location": location,
                "scrape_options": scrape_opts,
            }
            # Firecrawl rejects requests that set both include_domains and
            # exclude_domains — prefer include when we have a known host.
            if include_domains:
                search_kwargs["include_domains"] = include_domains
            else:
                search_kwargs["exclude_domains"] = EXCLUDE_SEARCH_DOMAINS
            try:
                search_data = self._sdk_search(query, **search_kwargs)
            except TypeError:
                search_kwargs.pop("exclude_domains", None)
                search_kwargs.pop("include_domains", None)
                try:
                    search_data = self._sdk_search(query, **search_kwargs)
                except OutOfCreditsError:
                    raise
                except Exception as exc:
                    logger.warning("Tier 2 search failed for %r: %s", query, exc)
                    continue
            except OutOfCreditsError:
                raise
            except Exception as exc:
                logger.warning("Tier 2 search failed for %r: %s", query, exc)
                continue

            for url, _title, markdown in self._search_items(search_data):
                lower = url.lower()
                if any(hint in lower for hint in SKIP_URL_HINTS):
                    continue
                if any(dom in lower for dom in EXCLUDE_SEARCH_DOMAINS):
                    continue
                if is_skipped_domain(url):
                    continue
                if markdown.strip() and self.is_dead_end_markdown(markdown):
                    self.dead_ends.append(url)
                    continue
                if markdown.strip():
                    collected.append((url, markdown))
                elif url not in [u for u, _ in collected]:
                    collected.append((url, ""))

        if self._store:
            self._store.commit_cost_events()

        self.last_contact_search_info = {
            "query": last_query,
            "candidates": [u for u, _ in collected[:6]],
        }

        batch_pages: list[tuple[str, str]] = []
        for url, markdown in collected[:3]:
            if not markdown.strip():
                markdown = self.scrape_url(url) or ""
            if markdown.strip():
                batch_pages.append((url, markdown))

        if not batch_pages:
            return None

        logger.info(
            "  Tier 2 scrape+JSON: %d candidate page(s)",
            len(batch_pages),
        )
        for url, _markdown in batch_pages:
            self.set_cost_context(stage="tier2_search")
            result = self._scrape_json(url, raw)
            if result and investigation_meets_bar(result, rules, property_type=raw.property_type)[0]:
                self.last_contact_search_info["matched_url"] = url
                return result
        return None

    def search_web(self, query: str, *, limit: int = 5) -> list[dict[str, str]]:
        """Firecrawl web search returning url/title snippets."""
        results: list[dict[str, str]] = []
        try:
            search_data = self._sdk_search(
                query,
                operation="search",
                limit=limit,
            )
        except OutOfCreditsError:
            raise
        except Exception as exc:
            logger.warning("Firecrawl search failed for %r: %s", query, exc)
            return results

        for url, title, _markdown in self._search_items(search_data):
            results.append({"url": url, "title": title})
        return results

    def search_news(
        self,
        query: str,
        *,
        limit: int = 5,
        location: str | None = None,
        tbs: str | None = None,
    ) -> list[dict[str, str]]:
        """Opt-in Firecrawl news search (settings.firecrawl_news_search_enabled).

        Returns empty when the flag is off.
        """
        if not self._settings.firecrawl_news_search_enabled:
            logger.debug("search_news skipped: firecrawl_news_search_enabled is false")
            return []

        search_kwargs: dict[str, Any] = {
            "operation": "search_news",
            "limit": limit,
            "sources": [{"type": "news"}],
            "ignore_invalid_urls": True,
        }
        if location:
            search_kwargs["location"] = location
        if tbs:
            search_kwargs["tbs"] = tbs

        results: list[dict[str, str]] = []
        try:
            search_data = self._sdk_search(query, **search_kwargs)
        except TypeError:
            search_kwargs.pop("sources", None)
            try:
                search_data = self._sdk_search(query, **search_kwargs)
            except OutOfCreditsError:
                raise
            except Exception as exc:
                logger.warning("Firecrawl news search failed for %r: %s", query, exc)
                return results
        except OutOfCreditsError:
            raise
        except Exception as exc:
            logger.warning("Firecrawl news search failed for %r: %s", query, exc)
            return results

        for url, title, snippet in self._search_items(search_data, include_news=True):
            results.append({"url": url, "title": title, "snippet": snippet})
        return results

    def scrape_change_tracking(
        self,
        url: str,
        *,
        modes: list[str] | None = None,
        tag: str | None = None,
    ) -> dict[str, Any] | None:
        """Opt-in Firecrawl scrape with changeTracking format (default off).

        Returns a small dict with markdown + change_tracking payload, or None when
        disabled or the scrape fails.
        """
        if not self._settings.firecrawl_change_tracking_enabled:
            logger.debug(
                "scrape_change_tracking skipped: firecrawl_change_tracking_enabled is false"
            )
            return None
        if not url.strip():
            return None

        from firecrawl.v2.types import ChangeTrackingFormat

        tracking_modes = modes or ["git-diff"]
        formats: list[Any] = [
            "markdown",
            ChangeTrackingFormat(type="change_tracking", modes=tracking_modes, tag=tag),
        ]
        try:
            doc = self._sdk_call_with_retry(
                lambda: self._sdk.scrape(url, formats=formats, **self._scrape_kwargs()),
                label="Firecrawl change_tracking",
                operation="change_tracking",
            )
        except OutOfCreditsError:
            raise
        except Exception as exc:
            logger.warning("Firecrawl changeTracking scrape failed for %s: %s", url, exc)
            return None

        change_tracking = getattr(doc, "change_tracking", None)
        if change_tracking is not None and hasattr(change_tracking, "model_dump"):
            change_tracking = change_tracking.model_dump(mode="json")
        markdown = getattr(doc, "markdown", None) or ""
        return {
            "url": url,
            "markdown": markdown,
            "change_tracking": change_tracking,
            "credits_used": self.last_credits_used,
            "credits_source": self.last_credits_source,
            "credits_reported": self.last_credits_reported,
            "credits_estimated": self.last_credits_estimated,
        }

    _OWNER_CHAIN_AGENT_SCHEMA: dict[str, Any] = {
        "type": "object",
        "properties": {
            "entity_name": {"type": "string"},
            "entity_number": {"type": "string"},
            "registered_agent": {"type": "string"},
            "owner_name": {"type": "string"},
            "officers": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "title": {"type": "string"},
                    },
                    "required": ["name"],
                },
            },
            "broker_name": {"type": "string"},
            "broker_phone": {"type": "string"},
            "broker_company": {"type": "string"},
            "source_note": {"type": "string"},
        },
    }


    def run_capped_agent(
        self,
        raw: RawLead,
        *,
        prompt: str | None = None,
    ) -> LeadInvestigationResult | None:
        """Capped Firecrawl /agent for hard contact gaps before owner_chain agent."""
        if self.should_stop_expensive_stages():
            return None
        max_credits = self._settings.firecrawl_agent_max_credits
        if max_credits <= 0:
            return None

        agent_prompt = prompt or (
            f"Find the named property manager, facilities director, or owner contact "
            f"(name + local phone) for {raw.business_name} at {raw.formatted_address}, "
            f"{raw.city} {raw.state}. Prefer on-site or management-company contacts. "
            f"Ignore toll-free corporate locators and reception/front desk lines."
        )
        urls = [raw.website] if raw.website else None
        try:
            result = self._sdk_call_with_retry(
                lambda: self._sdk.agent(
                    prompt=agent_prompt,
                    urls=urls,
                    max_credits=max_credits,
                    model=self._settings.firecrawl_agent_model,
                    timeout=max(30, int(self._settings.firecrawl_agent_timeout_s)),
                ),
                label="Firecrawl agent",
                operation="agent",
            )
        except OutOfCreditsError:
            raise
        except Exception as exc:
            logger.warning("Firecrawl capped agent failed: %s", exc)
            return None

        if result is None:
            return None
        if not self._agent_finished(result):
            self._cancel_agent_best_effort(result)
            logger.warning(
                "Firecrawl capped agent timed out/incomplete for %s",
                raw.business_name,
            )
            return None
        payload = result
        if hasattr(result, "model_dump"):
            payload = result.model_dump(mode="json")
        data = payload.get("data") if isinstance(payload, dict) else None
        if isinstance(data, dict):
            investigation = LeadInvestigationResult.from_api_payload(data)
            if investigation:
                page_text = str(data.get("markdown") or data.get("text") or agent_prompt)
                return self._ground_and_record(investigation, page_text, url=raw.website or "agent")
        if isinstance(payload, dict):
            investigation = LeadInvestigationResult.from_api_payload(payload)
            if investigation:
                page_text = str(payload.get("markdown") or payload.get("text") or agent_prompt)
                return self._ground_and_record(investigation, page_text, url=raw.website or "agent")
        return None

    def run_owner_chain_agent(
        self,
        *,
        entity_name: str,
        party_name: str,
        address: str,
        city: str,
        state_name: str,
        sos_url: str,
        recorder_url: str | None = None,
        parcel_url: str | None = None,
        max_credits: int = 100,
    ) -> dict[str, Any] | None:
        """Research-preview Firecrawl /agent for SOS/recorder/parcel owner lookups."""
        prompt_parts = [
            render_task(
                SOS_BIZFILE_TASK,
                portal_url=sos_url,
                entity_name=entity_name or party_name,
                state_name=state_name,
            )
        ]
        if recorder_url:
            prompt_parts.append(
                f"If no entity officers found, search the county recorder at {recorder_url} "
                f"for party {party_name!r} (grantor/grantee index only, no paid deed images)."
            )
        if parcel_url:
            prompt_parts.append(
                f"Optionally search the parcel portal at {parcel_url} for address "
                f"{address!r} in {city!r}, {state_name} and return the owner name if shown online."
            )
        prompt = " ".join(prompt_parts)

        try:
            response = self._sdk_call_with_retry(
                lambda: self._sdk.agent(
                    prompt=prompt,
                    schema=self._OWNER_CHAIN_AGENT_SCHEMA,
                    model="spark-1-mini",
                    max_credits=max_credits,
                    timeout=max(30, int(self._settings.firecrawl_agent_timeout_s)),
                ),
                label="Firecrawl owner-chain agent",
                operation="agent",
            )
        except OutOfCreditsError:
            raise
        except Exception as exc:
            logger.warning("Firecrawl owner-chain agent failed: %s", exc)
            return None

        if response is None:
            return None
        if not self._agent_finished(response):
            self._cancel_agent_best_effort(response)
            logger.warning(
                "Firecrawl owner-chain agent timed out/incomplete for %s",
                entity_name or party_name,
            )
            return None

        credits = getattr(response, "credits_used", None) or self.last_credits_used
        if credits and credits > 0:
            self._record_cost_event(int(credits), "agent")

        data = getattr(response, "data", None)
        if isinstance(data, dict):
            return data
        if hasattr(data, "model_dump"):
            return data.model_dump()
        return None

    @staticmethod
    def _agent_finished(response: Any) -> bool:
        """SDK wait_agent returns the last poll payload on timeout (often still running)."""
        status = getattr(response, "status", None)
        if status is None and isinstance(response, dict):
            status = response.get("status")
        if status is None:
            # Some payloads omit status when already terminal with data.
            data = getattr(response, "data", None)
            if data is None and isinstance(response, dict):
                data = response.get("data")
            return data is not None
        return str(status).lower() in {"completed", "failed", "cancelled"}

    def _cancel_agent_best_effort(self, response: Any, *, job_id: str | None = None) -> None:
        resolved = job_id
        if resolved is None:
            resolved = getattr(response, "id", None)
        if resolved is None and isinstance(response, dict):
            resolved = response.get("id")
        if not resolved:
            return
        try:
            self._sdk.cancel_agent(str(resolved))
            logger.info("Cancelled stalled Firecrawl agent job %s", resolved)
        except Exception as exc:
            logger.debug("cancel_agent(%s) failed: %s", resolved, exc)

    def get_queue_status(self) -> dict[str, Any]:
        """Fetch Firecrawl v2 queue/plan concurrency status."""
        try:
            status = self._sdk.get_queue_status()
            if hasattr(status, "model_dump"):
                payload = status.model_dump()
            else:
                payload = dict(status) if isinstance(status, dict) else {"raw": str(status)}
            max_conc = payload.get("maxConcurrency", payload.get("max_concurrency"))
            if max_conc is not None:
                try:
                    self._plan_max_concurrency = max(1, int(max_conc))
                    self._resolved_concurrency = None
                except (TypeError, ValueError):
                    pass
            return payload
        except Exception as exc:
            logger.warning("Firecrawl queue-status failed: %s", exc)
            return {"error": str(exc)[:200]}

    def plan_max_concurrency(self) -> int | None:
        """Firecrawl subscription concurrency (queue-status), refreshed once per client."""
        if self._plan_max_concurrency is not None:
            return self._plan_max_concurrency
        queue = self.get_queue_status()
        if queue.get("error"):
            from pallares_leads.costs import infer_firecrawl_plan, load_pricing

            pricing = load_pricing(self._settings.config_dir)
            _, plan = infer_firecrawl_plan(pricing)
            if plan:
                try:
                    browsers = int(plan.get("concurrent_browsers") or 0)
                except (TypeError, ValueError):
                    browsers = 0
                if browsers > 0:
                    self._plan_max_concurrency = browsers
            return self._plan_max_concurrency
        return self._plan_max_concurrency

    def refresh_plan_limits(self) -> dict[str, Any]:
        """Force a live queue-status + credit refresh so upgrades take effect immediately.

        Returns a small dict for logging / structured progress events.
        Never raises — probes degrade to pricing.yaml fallbacks.
        """
        from pallares_leads.costs import infer_firecrawl_plan, load_pricing

        self._plan_max_concurrency = None
        self._resolved_concurrency = None
        try:
            queue = self.get_queue_status()
        except Exception as exc:
            queue = {"error": str(exc)[:200]}
        try:
            credits = self.get_team_credit_usage()
        except Exception as exc:
            credits = {"error": str(exc)[:200]}
        plan_credits = credits.get("planCredits", credits.get("plan_credits"))
        pricing = load_pricing(self._settings.config_dir)
        plan_key, plan = infer_firecrawl_plan(
            pricing,
            plan_credits=plan_credits if not credits.get("error") else None,
            max_concurrency=self._plan_max_concurrency,
        )
        if self._plan_max_concurrency is None and plan:
            try:
                browsers = int(plan.get("concurrent_browsers") or 0)
            except (TypeError, ValueError):
                browsers = 0
            if browsers > 0:
                self._plan_max_concurrency = browsers
        concurrency = self.effective_max_concurrency()
        workers = self.effective_parallel_workers()
        remaining = credits.get("remainingCredits", credits.get("remaining_credits"))
        info = {
            "plan_key": plan_key,
            "plan_name": (plan or {}).get("name") if plan else None,
            "max_concurrency": concurrency,
            "place_workers": workers,
            "credits_remaining": remaining,
            "queue_error": queue.get("error"),
            "credits_error": credits.get("error"),
        }
        logger.info(
            "Firecrawl plan refresh: %s · %sw / %s browsers · remaining=%s",
            info.get("plan_name") or info.get("plan_key") or "unknown",
            workers,
            concurrency,
            remaining if remaining is not None else "?",
        )
        return info

    def effective_max_concurrency(self) -> int:
        """Plan concurrency from Firecrawl queue-status / pricing.yaml."""
        if self._resolved_concurrency is not None:
            return self._resolved_concurrency

        plan_limit = self.plan_max_concurrency()
        resolved = max(1, plan_limit) if plan_limit else 50
        # Temporary throttle after sustained 429s; restored on success.
        throttle = getattr(self, "_temp_worker_throttle", 0) or 0
        if throttle > 0:
            resolved = max(1, resolved // (2**throttle))
        self._resolved_concurrency = resolved
        return resolved

    def note_rate_limit(self) -> None:
        """Record a 429; after a burst, temporarily halve effective concurrency."""
        now = time.monotonic()
        window = getattr(self, "_rl_window_start", 0.0) or 0.0
        count = getattr(self, "_rl_window_count", 0) or 0
        if now - window > 60.0:
            self._rl_window_start = now
            self._rl_window_count = 1
        else:
            self._rl_window_count = count + 1
        if self._rl_window_count >= 5:
            prev = getattr(self, "_temp_worker_throttle", 0) or 0
            self._temp_worker_throttle = min(3, prev + 1)
            self._resolved_concurrency = None
            self._rl_window_count = 0
            self._rl_window_start = now
            logger.warning(
                "Sustained Firecrawl 429s — temporarily throttling concurrency "
                "(level %s)",
                self._temp_worker_throttle,
            )

    def note_rate_limit_recovered(self) -> None:
        """Clear temporary 429 throttle after a successful request."""
        if getattr(self, "_temp_worker_throttle", 0):
            self._temp_worker_throttle = 0
            self._resolved_concurrency = None

    def effective_parallel_workers(self) -> int:
        """Place-parallelism sized to saturate Firecrawl plan concurrency.

        Each in-flight place typically holds ~2 browser slots (multi-page scrape
        while map/search are quieter). Workers = plan_concurrency // 2 so total
        browser demand stays near the subscription max instead of the old
        conservative min(8, plan//10) cap (Standard 50 → 5 workers).
        """
        return max(1, self.effective_max_concurrency() // 2)

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
                used = max(0.0, float(plan) - float(remaining))
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
        billing_start = data.get("billingPeriodStart", data.get("billing_period_start"))
        if billing_start is not None:
            normalized["billingPeriodStart"] = billing_start
        try:
            rem_f = float(remaining) if remaining is not None else None
            plan_f = float(plan) if plan is not None else None
            if rem_f is not None and plan_f is not None and rem_f > plan_f:
                normalized["extraCredits"] = rem_f - plan_f
            else:
                normalized["extraCredits"] = 0.0
        except (TypeError, ValueError):
            normalized["extraCredits"] = None
        return normalized

    def get_team_credit_usage(self) -> dict[str, Any]:
        """Fetch remaining team credits from Firecrawl v2 API.

        Never raises — callers treat this as an optional probe. Transport /
        timeout failures return ``{"error": ...}`` so enrichment can continue.
        """
        try:
            with httpx.Client(timeout=15.0) as client:
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
                    return {
                        "error": response.text[:200],
                        "status_code": response.status_code,
                    }
                payload = self.normalize_team_credit_usage(response.json())
                # Attach plan concurrency so snapshots are self-contained for the dashboard.
                plan_conc = self.plan_max_concurrency()
                if plan_conc is not None:
                    payload["maxConcurrency"] = plan_conc
                if self._store:
                    remaining = payload.get(
                        "remainingCredits", payload.get("remaining_credits")
                    )
                    used = payload.get("usedCredits", payload.get("used_credits"))
                    try:
                        self._store.record_credit_snapshot(
                            provider="firecrawl",
                            remaining_credits=(
                                float(remaining) if remaining is not None else None
                            ),
                            used_credits=float(used) if used is not None else None,
                            snapshot=payload,
                        )
                    except (TypeError, ValueError):
                        self._store.record_credit_snapshot(
                            provider="firecrawl", snapshot=payload
                        )
                return payload
        except Exception as exc:
            logger.warning("Firecrawl credit-usage probe failed: %s", exc)
            return {"error": str(exc)[:200]}

    @staticmethod
    def dump_snapshot(path: Path, payload: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

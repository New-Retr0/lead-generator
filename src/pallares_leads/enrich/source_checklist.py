"""Config-driven per-lead source checklist — scrape public social/registry pages."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

import yaml

from pallares_leads.enrich.contact_extract import extract_contacts_from_markdown
from pallares_leads.schemas import EnrichedLead, LeadFact, RawLead, SiteContact

logger = logging.getLogger(__name__)

_LOGIN_WALL_MARKERS = (
    "sign in to continue",
    "log in to linkedin",
    "join linkedin",
    "you must log in",
    "content isn't available",
    "login • instagram",
)

_EMAIL = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")


@dataclass(frozen=True)
class SourceSpec:
    key: str
    tier: int
    access: str
    kind: str
    host_match: str = ""
    alt_hosts: tuple[str, ...] = ()
    path_suffix: str = ""
    description: str = ""


@dataclass
class SourceCheckResult:
    source_key: str
    status: str  # checked | login_wall | not_found | skipped
    url: str = ""
    reason: str = ""
    facts_added: int = 0


@lru_cache(maxsize=1)
def _load_sources(config_dir: str) -> dict[str, SourceSpec]:
    path = Path(config_dir) / "sources.yaml"
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    raw_sources = data.get("sources") or {}
    specs: dict[str, SourceSpec] = {}
    for key, raw in raw_sources.items():
        if not isinstance(raw, dict):
            continue
        specs[str(key)] = SourceSpec(
            key=str(key),
            tier=int(raw.get("tier") or 4),
            access=str(raw.get("access") or "public"),
            kind=str(raw.get("kind") or ""),
            host_match=str(raw.get("host_match") or ""),
            alt_hosts=tuple(raw.get("alt_hosts") or []),
            path_suffix=str(raw.get("path_suffix") or ""),
            description=str(raw.get("description") or ""),
        )
    return specs


def _host_matches(url: str, spec: SourceSpec) -> bool:
    try:
        host = urlparse(url).netloc.casefold().removeprefix("www.")
    except Exception:
        return False
    hosts = {spec.host_match.casefold()} if spec.host_match else set()
    hosts.update(h.casefold() for h in spec.alt_hosts)
    return any(h and h in host for h in hosts)


def _platform_for_url(url: str, specs: dict[str, SourceSpec]) -> str | None:
    for key, spec in specs.items():
        if spec.kind != "social":
            continue
        if _host_matches(url, spec):
            return key
    return None


def _is_login_wall(markdown: str, *, access: str) -> bool:
    if access == "serp_only":
        return True
    lower = (markdown or "").casefold()
    if len(lower.strip()) < 120 and access == "login_wall_risk":
        return True
    return any(marker in lower for marker in _LOGIN_WALL_MARKERS)


def collect_social_urls(enriched: EnrichedLead) -> dict[str, str]:
    """Platform key -> URL from social facts."""
    urls: dict[str, str] = {}
    for fact in enriched.facts:
        if fact.fact_kind != "social":
            continue
        platform = fact.value.get("platform") or fact.source_kind
        url = fact.value.get("url") or fact.source_url
        if platform and url:
            urls[platform] = url
    return urls


def _append_path_suffix(url: str, suffix: str) -> str:
    if not suffix:
        return url
    base = url.rstrip("/")
    if base.endswith(suffix.rstrip("/")):
        return base
    return f"{base}{suffix}"


def run_source_checklist(
    raw: RawLead,
    enriched: EnrichedLead,
    *,
    config_dir: Path,
    scrape_url,
    max_pages: int = 6,
) -> tuple[list[LeadFact], list[SourceCheckResult], list[SiteContact]]:
    """Scrape public social pages discovered on the lead. Returns new facts, check log, contacts."""
    specs = _load_sources(str(config_dir))
    social_urls = collect_social_urls(enriched)
    results: list[SourceCheckResult] = []
    new_facts: list[LeadFact] = []
    new_contacts: list[SiteContact] = []
    pages_used = 0

    for platform, url in social_urls.items():
        spec = specs.get(platform)
        if not spec:
            continue
        if spec.access == "serp_only":
            results.append(
                SourceCheckResult(
                    source_key=platform,
                    status="skipped",
                    url=url,
                    reason="SERP-only source — never scrape profile URL",
                )
            )
            continue
        if pages_used >= max_pages:
            results.append(
                SourceCheckResult(
                    source_key=platform,
                    status="skipped",
                    url=url,
                    reason=f"source checklist cap ({max_pages} pages)",
                )
            )
            continue

        target = _append_path_suffix(url, spec.path_suffix)
        markdown = scrape_url(target)
        pages_used += 1

        if not markdown:
            results.append(
                SourceCheckResult(
                    source_key=platform,
                    status="not_found",
                    url=target,
                    reason="empty response",
                )
            )
            continue

        if _is_login_wall(markdown, access=spec.access):
            results.append(
                SourceCheckResult(
                    source_key=platform,
                    status="login_wall",
                    url=target,
                    reason="login wall detected — skipped",
                )
            )
            continue

        extracted = extract_contacts_from_markdown(markdown, source_url=target)
        facts_before = len(new_facts)
        for contact in extracted:
            if contact.name:
                new_contacts.append(
                    SiteContact(
                        label=contact.role or platform,
                        name=contact.name or "",
                        phone=contact.phone or "",
                        email=contact.email_or_form or "",
                        source_url=target,
                        verification="corroborated",
                        quote=contact.quote or "",
                    )
                )
            if contact.phone:
                new_facts.append(
                    LeadFact(
                        fact_kind="phone",
                        value={"phone": contact.phone, "label": platform},
                        source_kind=platform,
                        source_url=target,
                        method="deterministic_parse",
                        quote=contact.quote or contact.phone,
                        verification="corroborated",
                    )
                )
            email = contact.email_or_form or ""
            if email and "@" in email:
                new_facts.append(
                    LeadFact(
                        fact_kind="email",
                        value={"email": email, "label": platform},
                        source_kind=platform,
                        source_url=target,
                        method="deterministic_parse",
                        quote=contact.quote or email,
                        verification="corroborated",
                    )
                )

        for email_match in _EMAIL.finditer(markdown[:4000]):
            email = email_match.group()
            if "example.com" in email:
                continue
            new_facts.append(
                LeadFact(
                    fact_kind="email",
                    value={"email": email, "label": f"{platform} page"},
                    source_kind=platform,
                    source_url=target,
                    method="deterministic_parse",
                    quote=email,
                    verification="corroborated",
                )
            )
            break

        results.append(
            SourceCheckResult(
                source_key=platform,
                status="checked",
                url=target,
                reason=f"scraped {platform} page",
                facts_added=len(new_facts) - facts_before,
            )
        )

    # Record wired sources that ran elsewhere
    for wired_key in ("bbb", "google_places", "company_website", "state_license"):
        if wired_key == "bbb" and any(f.source_kind == "bbb" for f in enriched.facts):
            results.append(
                SourceCheckResult(source_key="bbb", status="checked", reason="BBB tier ran")
            )
        if wired_key == "state_license" and any(
            f.source_kind == "state_license" for f in enriched.facts
        ):
            results.append(
                SourceCheckResult(
                    source_key="state_license",
                    status="checked",
                    reason="state license lookup ran",
                )
            )

    return new_facts, results, new_contacts

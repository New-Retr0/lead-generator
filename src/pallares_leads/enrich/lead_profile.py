from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

from pallares_leads.enrich.contact_requirements import (
    EnrichmentRules,
    enriched_meets_bar,
    is_callable_phone,
)
from pallares_leads.enrich.google_gaps import is_corporate_locator_url
from pallares_leads.schemas import EnrichedLead, NOT_FOUND, RawLead
from pallares_leads.utils.normalize import slugify

SiteKind = str  # corporate_locator | local_site | no_site

# Known franchise brands — name pattern + optional website domain hints
_BRAND_DEFS: tuple[tuple[str, re.Pattern[str], tuple[str, ...]], ...] = (
    # Gas
    ("shell", re.compile(r"\bshell\b", re.I), ("shell.com", "find.shell.com")),
    ("chevron", re.compile(r"\bchevron\b", re.I), ("chevron.com",)),
    ("76", re.compile(r"\b76\b|\bunocal\b", re.I), ("76.com",)),
    ("sinclair", re.compile(r"\bsinclair\b", re.I), ("sinclairoil.com",)),
    ("bp", re.compile(r"\bbp\b|\bbritish petroleum\b", re.I), ("bp.com",)),
    ("exxon", re.compile(r"\bexxon\b|\bmobil\b", re.I), ("exxon.com", "exxonmobil.com")),
    ("arco", re.compile(r"\barco\b", re.I), ("arco.com",)),
    ("valero", re.compile(r"\bvalero\b", re.I), ("valero.com",)),
    ("circle_k", re.compile(r"\bcircle\s*k\b", re.I), ("circlek.com",)),
    ("speedway", re.compile(r"\bspeedway\b", re.I), ("speedway.com",)),
    # Fast food / QSR
    ("mcdonalds", re.compile(r"\bmcdonald", re.I), ("mcdonalds.com",)),
    ("burger_king", re.compile(r"\bburger\s*king\b", re.I), ("bk.com", "burgerking.com")),
    ("wendys", re.compile(r"\bwendy", re.I), ("wendys.com",)),
    ("subway", re.compile(r"\bsubway\b", re.I), ("subway.com",)),
    ("starbucks", re.compile(r"\bstarbucks\b", re.I), ("starbucks.com",)),
    ("chipotle", re.compile(r"\bchipotle\b", re.I), ("chipotle.com",)),
    ("jack_in_the_box", re.compile(r"\bjack\s*in\s*the\s*box\b", re.I), ("jackinthebox.com",)),
    ("carls_jr", re.compile(r"\bcarl'?s?\s*jr\b", re.I), ("carlsjr.com",)),
    ("taco_bell", re.compile(r"\btaco\s*bell\b", re.I), ("tacobell.com",)),
    ("pizza_hut", re.compile(r"\bpizza\s*hut\b", re.I), ("pizzahut.com",)),
    ("dominos", re.compile(r"\bdomino", re.I), ("dominos.com",)),
    ("kfc", re.compile(r"\bkfc\b|\bkentucky fried\b", re.I), ("kfc.com",)),
    ("dairy_queen", re.compile(r"\bdairy\s*queen\b", re.I), ("dairyqueen.com",)),
    ("in_n_out", re.compile(r"\bin[- ]n[- ]out\b", re.I), ("in-n-out.com",)),
    # Grocery / big box
    ("save_mart", re.compile(r"\bsave\s*mart\b", re.I), ("savemart.com",)),
    ("food_maxx", re.compile(r"\bfood\s*maxx\b", re.I), ("foodmaxx.com",)),
    ("walmart", re.compile(r"\bwalmart\b", re.I), ("walmart.com",)),
    ("target", re.compile(r"\btarget\b", re.I), ("target.com",)),
    ("costco", re.compile(r"\bcostco\b", re.I), ("costco.com",)),
    ("trader_joes", re.compile(r"\btrader\s*joe", re.I), ("traderjoes.com",)),
    ("aldi", re.compile(r"\baldi\b", re.I), ("aldi.us",)),
    ("safeway", re.compile(r"\bsafeway\b", re.I), ("safeway.com",)),
    ("ralphs", re.compile(r"\bralphs\b", re.I), ("ralphs.com",)),
    # Pharmacy
    ("cvs", re.compile(r"\bcvs\b", re.I), ("cvs.com",)),
    ("walgreens", re.compile(r"\bwalgreens\b", re.I), ("walgreens.com",)),
    ("rite_aid", re.compile(r"\brite\s*aid\b", re.I), ("riteaid.com",)),
    # Bank
    ("chase", re.compile(r"\bchase\b", re.I), ("chase.com",)),
    ("wells_fargo", re.compile(r"\bwells\s*fargo\b", re.I), ("wellsfargo.com",)),
    ("bank_of_america", re.compile(r"\bbank\s*of\s*america\b|\bbofa\b", re.I), ("bankofamerica.com",)),
    # Medical systems (often anchor medical plazas)
    ("adventist_health", re.compile(r"\badventist\s*health\b", re.I), ("adventisthealth.org",)),
    ("kaiser", re.compile(r"\bkaiser\b", re.I), ("kaiserpermanente.org",)),
    ("omni_family_health", re.compile(r"\bomni\s*family\s*health\b", re.I), ("omnifamilyhealth.org",)),
)

# Franchise location profiles: corporate locator + Google phone is usually enough
_STATIC_TRUST_PATTERNS: tuple[str, ...] = (
    "gas_station:corporate_locator:*",
    "fast_food:corporate_locator:*",
    "grocery:corporate_locator:*",
    "pharmacy:corporate_locator:*",
    "bank:corporate_locator:*",
)

# Categories where enrichment learns per management company (cross-property reuse)
MULTI_TENANT_PROPERTY_TYPES = frozenset({
    "strip_mall",
    "shopping_center",
    "medical_plaza",
    "property_manager",
})

_SKIP_DOMAINS = frozenset({
    "google.com",
    "facebook.com",
    "instagram.com",
    "yelp.com",
    "linkedin.com",
    "twitter.com",
    "x.com",
    "mapquest.com",
})


@dataclass(frozen=True)
class LeadProfile:
    """Relational identity for a lead — same profile ≈ same enrichment playbook."""

    property_type: str
    site_kind: SiteKind
    brand: str

    @property
    def key(self) -> str:
        return f"{self.property_type}:{self.site_kind}:{self.brand}"

    @property
    def is_franchise_pattern(self) -> bool:
        return self.site_kind == "corporate_locator" or self.brand != "independent"

    @property
    def is_multi_tenant(self) -> bool:
        return self.property_type in MULTI_TENANT_PROPERTY_TYPES


@dataclass
class EnrichmentPlaybook:
    """Learned or default strategy for leads sharing a profile."""

    trust_google_phone: bool = False
    skip_firecrawl: bool = False
    skip_agent: bool = False
    contact_role_label: str = "Store / Location"
    typical_source_tool: str = ""
    winning_tier: str = ""
    website_domain: str = ""
    success_count: int = 0
    sample_place_id: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "trust_google_phone": self.trust_google_phone,
            "skip_firecrawl": self.skip_firecrawl,
            "skip_agent": self.skip_agent,
            "contact_role_label": self.contact_role_label,
            "typical_source_tool": self.typical_source_tool,
            "winning_tier": self.winning_tier,
            "website_domain": self.website_domain,
            "success_count": self.success_count,
            "sample_place_id": self.sample_place_id,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> EnrichmentPlaybook:
        if not data:
            return cls()
        return cls(
            trust_google_phone=bool(data.get("trust_google_phone")),
            skip_firecrawl=bool(data.get("skip_firecrawl")),
            skip_agent=bool(data.get("skip_agent", True)),
            contact_role_label=str(data.get("contact_role_label") or "Store / Location"),
            typical_source_tool=str(data.get("typical_source_tool") or ""),
            winning_tier=str(data.get("winning_tier") or ""),
            website_domain=str(data.get("website_domain") or ""),
            success_count=int(data.get("success_count") or 0),
            sample_place_id=str(data.get("sample_place_id") or ""),
        )


def registrable_domain(url: str | None) -> str:
    if not url:
        return ""
    host = urlparse(url).netloc.lower().removeprefix("www.")
    if not host or any(skip in host for skip in _SKIP_DOMAINS):
        return ""
    parts = host.split(".")
    if len(parts) >= 2:
        return ".".join(parts[-2:])
    return host


def management_profile_key(
    website: str | None,
    pm_clue: str = "",
) -> str | None:
    """Cross-property key for PM companies — reuse enrichment strategy across plazas."""
    domain = registrable_domain(website)
    if domain and not is_corporate_locator_url(website or ""):
        return f"mgmt:{domain.replace('.', '-')}"
    clue = (pm_clue or "").strip()
    if clue and clue not in (NOT_FOUND, "unknown", "n/a"):
        return f"mgmt:{slugify(clue[:80])}"
    return None


def lead_fingerprint(raw: RawLead) -> str:
    """Near-duplicate key when Google returns multiple place_ids for the same storefront."""
    street = raw.formatted_address.split(",")[0].strip() if raw.formatted_address else ""
    brand = detect_brand(raw.business_name, raw.website)
    return f"{raw.property_type}:{brand}:{slugify(street)}:{slugify(raw.city)}"


def _site_kind(website: str | None) -> SiteKind:
    if not website:
        return "no_site"
    if is_corporate_locator_url(website):
        return "corporate_locator"
    return "local_site"


def detect_brand(business_name: str, website: str | None) -> str:
    name = business_name or ""
    site = (website or "").lower()
    for slug, pattern, domains in _BRAND_DEFS:
        if pattern.search(name):
            return slug
        if site and any(d in site for d in domains):
            return slug
    if site and is_corporate_locator_url(site):
        host = urlparse(site).netloc.lower().removeprefix("www.")
        root = host.split(".")[0] if host else "corporate"
        return root if root not in ("find", "locator", "maps") else host.split(".")[1] if "." in host else "corporate"
    return "independent"


def classify_lead(raw: RawLead) -> LeadProfile:
    return LeadProfile(
        property_type=raw.property_type,
        site_kind=_site_kind(raw.website),
        brand=detect_brand(raw.business_name, raw.website),
    )


def _pattern_matches(profile_key: str, pattern: str) -> bool:
    if pattern == profile_key:
        return True
    parts = pattern.split(":")
    key_parts = profile_key.split(":")
    if len(parts) != len(key_parts):
        return False
    return all(p == k or p == "*" for p, k in zip(parts, key_parts, strict=True))


def static_playbook_for(profile: LeadProfile) -> EnrichmentPlaybook | None:
    key = profile.key
    for pattern in _STATIC_TRUST_PATTERNS:
        if _pattern_matches(key, pattern):
            return EnrichmentPlaybook(
                trust_google_phone=True,
                skip_firecrawl=True,
                skip_agent=True,
                contact_role_label="Store / Location",
                winning_tier="places_only",
            )
    return None


def merge_playbooks(
    profile: LeadProfile,
    *,
    static: EnrichmentPlaybook | None,
    learned: EnrichmentPlaybook | None,
    mgmt: EnrichmentPlaybook | None,
    rules: EnrichmentRules,
) -> EnrichmentPlaybook:
    """Combine static franchise defaults, DB-learned outcomes, and mgmt-company playbooks."""
    base = EnrichmentPlaybook()
    if static:
        base = EnrichmentPlaybook(**{**base.to_dict(), **static.to_dict()})
    if learned and learned.success_count > 0:
        merged = base.to_dict()
        learned_data = learned.to_dict()
        for key in (
            "trust_google_phone",
            "skip_firecrawl",
            "skip_agent",
            "contact_role_label",
            "typical_source_tool",
            "winning_tier",
            "website_domain",
        ):
            if learned_data.get(key):
                merged[key] = learned_data[key]
        merged["success_count"] = learned_data["success_count"]
        merged["sample_place_id"] = learned_data.get("sample_place_id") or merged.get("sample_place_id", "")
        base = EnrichmentPlaybook.from_dict(merged)
    if mgmt and mgmt.success_count > 0:
        base.skip_agent = base.skip_agent or mgmt.skip_agent
        if mgmt.typical_source_tool:
            base.typical_source_tool = mgmt.typical_source_tool
        if mgmt.winning_tier:
            base.winning_tier = mgmt.winning_tier
        if mgmt.contact_role_label and mgmt.contact_role_label != "Store / Location":
            base.contact_role_label = mgmt.contact_role_label
    if rules.franchise_fast_path and profile.is_franchise_pattern and profile.site_kind == "corporate_locator":
        base.trust_google_phone = True
        base.skip_firecrawl = True
        base.skip_agent = True
    return base


def should_use_profile_fast_path(
    raw: RawLead,
    profile: LeadProfile,
    playbook: EnrichmentPlaybook,
    rules: EnrichmentRules,
) -> tuple[bool, str]:
    if rules.always_investigate:
        return False, "category requires full Firecrawl investigation"
    if rules.require_property_manager_clue:
        return False, "category requires property manager clue"
    if not is_callable_phone(raw.main_phone):
        return False, "no callable Google Places phone"
    if not playbook.trust_google_phone or not playbook.skip_firecrawl:
        return False, "profile has not established franchise phone-only path"

    probe = EnrichedLead.model_validate(raw.model_dump())
    probe.best_contact_phone = raw.main_phone or ""
    probe.best_contact_role = playbook.contact_role_label
    met, detail = enriched_meets_bar(probe, rules)
    if not met:
        return False, f"Places phone alone does not meet bar: {detail}"

    if playbook.success_count > 0:
        reason = f"relational profile {profile.key} ({playbook.success_count} prior success(es))"
    else:
        reason = f"franchise default for {profile.key}"
    return True, reason


def _winning_tier_from_source(source_tool: str) -> str:
    if "profile_reuse" in source_tool or source_tool == "google_places":
        return "places_only"
    if "search" in source_tool:
        return "search"
    if "agent" in source_tool:
        return "agent"
    if "scrape_json" in source_tool:
        return "scrape_json"
    if "scrape" in source_tool:
        return "markdown"
    return ""


def learn_playbook_from_outcome(
    profile: LeadProfile,
    raw: RawLead,
    enriched: EnrichedLead,
    *,
    rules: EnrichmentRules,
    agent_ran: bool,
    firecrawl_skipped: bool,
) -> EnrichmentPlaybook:
    """Derive playbook updates from a completed enrichment."""
    met, _ = enriched_meets_bar(enriched, rules)
    phone_from_places = is_callable_phone(raw.main_phone) and (
        enriched.best_contact_phone == raw.main_phone
        or enriched.best_contact_phone in ("", NOT_FOUND)
    )

    playbook = EnrichmentPlaybook(sample_place_id=raw.place_id)
    tier = _winning_tier_from_source(enriched.source_tool)
    if tier:
        playbook.winning_tier = tier
    playbook.website_domain = registrable_domain(enriched.website or raw.website)

    if met and phone_from_places and profile.is_franchise_pattern:
        playbook.trust_google_phone = True
        playbook.skip_firecrawl = firecrawl_skipped or not agent_ran
        playbook.skip_agent = not agent_ran
        playbook.typical_source_tool = enriched.source_tool
        if enriched.best_contact_role not in ("", NOT_FOUND):
            playbook.contact_role_label = enriched.best_contact_role
    elif met and not agent_ran:
        playbook.skip_agent = True
        playbook.typical_source_tool = enriched.source_tool

    return playbook


def learn_management_playbook(
    enriched: EnrichedLead,
    *,
    rules: EnrichmentRules,
    agent_ran: bool,
) -> tuple[str, EnrichmentPlaybook] | None:
    """Build a management-company playbook when multi-tenant enrichment succeeds."""
    if enriched.property_type not in MULTI_TENANT_PROPERTY_TYPES:
        return None
    met, _ = enriched_meets_bar(enriched, rules)
    if not met:
        return None
    key = management_profile_key(
        enriched.website,
        enriched.property_manager_or_ownership_clue,
    )
    if not key:
        return None
    role = enriched.best_contact_role
    if role in ("", NOT_FOUND):
        role = "Property Manager / Leasing"
    return key, EnrichmentPlaybook(
        skip_agent=not agent_ran,
        contact_role_label=role,
        typical_source_tool=enriched.source_tool,
        winning_tier=_winning_tier_from_source(enriched.source_tool),
        website_domain=registrable_domain(enriched.website),
        sample_place_id=enriched.place_id,
    )

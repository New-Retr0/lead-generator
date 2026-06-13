from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING, Literal

import yaml

from pallares_leads.enrich.schema import LeadInvestigationResult
from pallares_leads.schemas import NOT_FOUND, EnrichedLead, RawLead
from pallares_leads.utils.normalize import is_placeholder_phone, phone_digits

if TYPE_CHECKING:
    from pallares_leads.enrich.google_gaps import GoogleGaps
    from pallares_leads.settings import Settings

ContactBar = Literal["form", "email", "phone", "labeled_phone"]

_BAR_ORDER: dict[ContactBar, int] = {
    "form": 0,
    "email": 1,
    "phone": 2,
    "labeled_phone": 3,
}

_FACILITIES_ROLES = re.compile(
    r"\b(facilit(y|ies)|property\s*manager|building\s*manager|maintenance|operations|leasing)\b",
    re.I,
)
_PATIENT_FACING_ROLES = re.compile(
    r"\b(patient|appointment|scheduling|nurse|physician|doctor|clinical|urgent\s*care|"
    r"reception|medical\s*records|billing)\b",
    re.I,
)


def _role_text(*parts: str | None) -> str:
    return " ".join(p.strip() for p in parts if p and p.strip())


def is_patient_facing_role(role: str, *, property_type: str) -> bool:
    if property_type != "medical_plaza" or not role.strip():
        return False
    if _FACILITIES_ROLES.search(role):
        return False
    return bool(_PATIENT_FACING_ROLES.search(role))


def _investigation_role_text(result: LeadInvestigationResult) -> str:
    parts = [result.contact_role, result.contact_name]
    for contact in result.site_contacts:
        parts.extend([contact.label, contact.name])
    return _role_text(*parts)


def is_patient_facing_investigation(result: LeadInvestigationResult, *, property_type: str) -> bool:
    if property_type != "medical_plaza":
        return False
    text = _investigation_role_text(result)
    if _FACILITIES_ROLES.search(text):
        return False
    return bool(_PATIENT_FACING_ROLES.search(text))


@dataclass(frozen=True)
class EnrichmentRules:
    """Per-category sales contact requirements — loaded from config/categories.yaml."""

    min_contact_bar: ContactBar = "phone"
    require_property_manager_clue: bool = False
    always_investigate: bool = False
    franchise_fast_path: bool = False
    suggest_recurring: bool = False
    allow_owner_chain: bool = False
    registry_lookup: tuple[str, ...] = ("bbb",)
    insurance_keywords: tuple[str, ...] = ()

    def registry_lookups(self) -> frozenset[str]:
        return frozenset(item.strip().lower() for item in self.registry_lookup if item.strip())

    @classmethod
    def from_mapping(
        cls, data: dict | None, *, defaults: EnrichmentRules | None = None
    ) -> EnrichmentRules:
        base = defaults or default_enrichment_rules()
        if not data:
            return base
        bar = str(data.get("min_contact_bar") or base.min_contact_bar).lower()
        if bar not in _BAR_ORDER:
            bar = base.min_contact_bar
        registry_raw = data.get("registry_lookup", base.registry_lookup)
        if isinstance(registry_raw, str):
            registry_lookup = tuple(
                part.strip() for part in registry_raw.split(",") if part.strip()
            ) or base.registry_lookup
        elif isinstance(registry_raw, (list, tuple)):
            registry_lookup = tuple(str(item).strip() for item in registry_raw if str(item).strip())
        else:
            registry_lookup = base.registry_lookup

        raw_ins = data.get("insurance_keywords", base.insurance_keywords)
        if isinstance(raw_ins, str):
            insurance_keywords = (raw_ins,) if raw_ins else ()
        elif isinstance(raw_ins, (list, tuple)):
            insurance_keywords = tuple(str(k) for k in raw_ins if k)
        else:
            insurance_keywords = base.insurance_keywords

        return cls(
            min_contact_bar=bar,  # type: ignore[arg-type]
            require_property_manager_clue=bool(
                data.get("require_property_manager_clue", base.require_property_manager_clue)
            ),
            always_investigate=bool(data.get("always_investigate", base.always_investigate)),
            franchise_fast_path=bool(data.get("franchise_fast_path", base.franchise_fast_path)),
            suggest_recurring=bool(data.get("suggest_recurring", base.suggest_recurring)),
            allow_owner_chain=bool(data.get("allow_owner_chain", base.allow_owner_chain)),
            registry_lookup=registry_lookup,
            insurance_keywords=insurance_keywords,
        )


def default_enrichment_rules() -> EnrichmentRules:
    return EnrichmentRules()


@lru_cache(maxsize=1)
def _load_category_enrichment(
    config_dir: str,
) -> tuple[EnrichmentRules, dict[str, EnrichmentRules]]:
    path = Path(config_dir) / "categories.yaml"
    with path.open(encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}

    defaults = EnrichmentRules.from_mapping(data.get("enrichment_defaults"))
    by_property_type: dict[str, EnrichmentRules] = {}
    categories = data.get("categories") or {}
    if isinstance(categories, dict):
        for _key, category in categories.items():
            if not isinstance(category, dict):
                continue
            property_type = str(category.get("property_type") or _key)
            enrichment = category.get("enrichment")
            if isinstance(enrichment, dict):
                by_property_type[property_type] = EnrichmentRules.from_mapping(
                    enrichment, defaults=defaults
                )
            else:
                by_property_type[property_type] = defaults
    return defaults, by_property_type


def get_enrichment_rules(property_type: str, config_dir: Path | None) -> EnrichmentRules:
    if config_dir is None:
        return default_enrichment_rules()
    defaults, by_type = _load_category_enrichment(str(config_dir))
    return by_type.get(property_type, defaults)


def clear_enrichment_rules_cache() -> None:
    _load_category_enrichment.cache_clear()


def is_callable_phone(value: str | None) -> bool:
    if not value or value == NOT_FOUND:
        return False
    if is_placeholder_phone(value):
        return False
    digits = phone_digits(value)
    return len(digits) == 10


def _contact_bar_level(
    result: LeadInvestigationResult | None, *, property_type: str = ""
) -> ContactBar:
    if result is None:
        return "form"

    if _has_labeled_phone(result, property_type=property_type):
        return "labeled_phone"
    if _has_any_phone(result):
        return "phone"
    if _has_email(result):
        return "email"
    if result.contact_form_url:
        return "form"
    return "form"


def _has_any_phone(result: LeadInvestigationResult) -> bool:
    if is_callable_phone(result.contact_phone):
        return True
    return any(is_callable_phone(contact.phone) for contact in result.site_contacts)


def _has_labeled_phone(result: LeadInvestigationResult, *, property_type: str = "") -> bool:
    for contact in result.site_contacts:
        if is_callable_phone(contact.phone) and (contact.label.strip() or contact.name.strip()):
            role = _role_text(contact.label, contact.name)
            if is_patient_facing_role(role, property_type=property_type):
                continue
            return True
    if is_callable_phone(result.contact_phone) and (
        result.contact_role.strip() or result.contact_name.strip()
    ):
        role = _role_text(result.contact_role, result.contact_name)
        if is_patient_facing_role(role, property_type=property_type):
            return False
        return True
    return False


def _has_email(result: LeadInvestigationResult) -> bool:
    if result.contact_email and "@" in result.contact_email:
        return True
    return any("@" in contact.email for contact in result.site_contacts if contact.email)


def has_property_manager_clue(result: LeadInvestigationResult | None) -> bool:
    if result is None:
        return False
    clue = result.property_manager.strip()
    return bool(clue and clue.lower() not in {"not found", "unknown", "n/a"})


def investigation_meets_bar(
    result: LeadInvestigationResult | None,
    rules: EnrichmentRules,
    *,
    property_type: str = "",
) -> tuple[bool, str]:
    if result is None:
        return False, "no Tier 1 result"

    level = _contact_bar_level(result, property_type=property_type)

    if property_type == "medical_plaza" and is_patient_facing_investigation(
        result, property_type=property_type
    ):
        return False, "medical plaza needs facilities/operations contact, not patient line"

    if _BAR_ORDER[level] < _BAR_ORDER[rules.min_contact_bar]:
        return False, f"contact bar is {level}, need {rules.min_contact_bar}"

    if rules.require_property_manager_clue and not has_property_manager_clue(result):
        return False, "missing property manager / ownership clue"

    return True, f"meets {rules.min_contact_bar} bar"


def enriched_meets_bar(
    enriched: EnrichedLead,
    rules: EnrichmentRules,
) -> tuple[bool, str]:
    level: ContactBar = "form"
    phone = enriched.best_contact_phone
    if phone in ("", NOT_FOUND):
        phone = enriched.main_phone or ""

    if is_callable_phone(phone):
        role = enriched.best_contact_role if enriched.best_contact_role != NOT_FOUND else ""
        labeled = bool(role.strip()) or any(
            is_callable_phone(c.phone) and (c.label.strip() or c.name.strip())
            for c in enriched.site_contacts
        )
        if labeled and is_patient_facing_role(role, property_type=enriched.property_type):
            labeled = False
        level = "labeled_phone" if labeled else "phone"
    else:
        email = enriched.best_contact_email_or_form
        if email not in ("", NOT_FOUND) and "@" in email:
            level = "email"
        elif email not in ("", NOT_FOUND):
            level = "form"

    if _BAR_ORDER[level] < _BAR_ORDER[rules.min_contact_bar]:
        return False, f"contact bar is {level}, need {rules.min_contact_bar}"

    if rules.require_property_manager_clue:
        clue = enriched.property_manager_or_ownership_clue
        if clue in ("", NOT_FOUND):
            return False, "missing property manager / ownership clue"

    return True, f"meets {rules.min_contact_bar} bar"


def sales_gaps_vs_ideal(enriched: EnrichedLead, rules: EnrichmentRules) -> list[str]:
    gaps: list[str] = []
    if not enriched.why_this_is_a_good_fit.strip():
        gaps.append("missing why_call")
    if not enriched.sales_talking_points.strip():
        gaps.append("missing talking_points")

    met, detail = enriched_meets_bar(enriched, rules)
    if not met:
        gaps.append(detail)

    if not enriched.exterior_cleaning_need_signals.strip():
        gaps.append("no exterior signals")
    return gaps


def tier2_gap_reason(
    result: LeadInvestigationResult | None,
    raw: RawLead,
    *,
    gaps: GoogleGaps | None = None,
    settings: Settings | None = None,
) -> tuple[bool, str]:
    config_dir = settings.config_dir if settings else None
    rules = get_enrichment_rules(raw.property_type, config_dir)

    if not raw.website:
        return True, "no website on Google listing"

    if gaps and gaps.corporate_website:
        return True, "corporate locator URL — need local store contact"

    if gaps and gaps.missing_phone and rules.min_contact_bar in ("phone", "labeled_phone"):
        return True, "Google listing missing phone"

    if result is None:
        return True, "Tier 1 returned no result"

    met, detail = investigation_meets_bar(result, rules, property_type=raw.property_type)
    if not met:
        if raw.property_type == "property_manager" and is_callable_phone(raw.main_phone):
            return False, "property_manager Google main line meets outreach bar"
        return True, f"Tier 1 below sales contact bar: {detail}"

    if rules.require_property_manager_clue and not has_property_manager_clue(result):
        if raw.property_type == "property_manager" and is_callable_phone(raw.main_phone):
            return False, "property_manager Google main line usable without PM clue"
        return True, "missing property manager / ownership clue after Tier 1"

    return False, f"Tier 1 meets sales contact bar ({rules.min_contact_bar})"


def needs_tier2_gap_fill(
    result: LeadInvestigationResult | None,
    raw: RawLead,
    *,
    gaps: GoogleGaps | None = None,
    settings: Settings | None = None,
) -> bool:
    needed, _ = tier2_gap_reason(result, raw, gaps=gaps, settings=settings)
    return needed

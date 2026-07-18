from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING, Literal

import yaml

from pallares_leads.enrich.schema import LeadInvestigationResult
from pallares_leads.enrich.verify import is_placeholder_name
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

# Multi-tenant / CRE categories: Google main line is outreach phone, not a DM.
DM_REQUIRED_PROPERTY_TYPES = frozenset(
    {
        "strip_mall",
        "shopping_center",
        "hotel",
        "hoa",
        "parking",
        "parking_small",
        "parking_large_private",
        "industrial",
        "property_manager",
        "medical_plaza",
    }
)

_TOLL_FREE_PREFIXES = frozenset(
    {"800", "888", "877", "866", "855", "844", "833", "822"}
)

_DEFAULT_DECISION_ROLES = (
    "owner",
    "property owner",
    "property_owner",
    "property manager",
    "property_manager",
    "facilities",
    "leasing",
    "portfolio",
    "registered agent",
    "registered_agent",
    "cre broker",
    "cre_broker",
    "broker",
    "principal",
    "director",
    "general manager",
    "maintenance",
    "landlord",
)
_DEFAULT_FACILITIES = (
    r"facilit(y|ies)|property\s*manager|building\s*manager|maintenance|operations|"
    r"leasing|owner|portfolio|general\s*manager|director"
)
_DEFAULT_JUNK = (
    r"patient|appointment|scheduling|nurse|physician|doctor|clinical|urgent\s*care|"
    r"reception|receptionist|front\s*desk|medical\s*records|billing|customer\s*service|"
    r"support\s*desk|info\s*desk|concierge|reservations?|booking"
)


def _project_config_dir() -> Path:
    return Path(__file__).resolve().parents[3] / "config"


@lru_cache(maxsize=1)
def _load_decision_role_config(
    config_path: str,
) -> tuple[tuple[str, ...], re.Pattern[str], re.Pattern[str]]:
    path = Path(config_path)
    roles: tuple[str, ...] = _DEFAULT_DECISION_ROLES
    facilities_pat = _DEFAULT_FACILITIES
    junk_pat = _DEFAULT_JUNK
    if path.is_file():
        with path.open(encoding="utf-8") as handle:
            data = yaml.safe_load(handle) or {}
        raw_roles = data.get("decision_roles") or []
        if isinstance(raw_roles, list) and raw_roles:
            roles = tuple(str(item) for item in raw_roles if str(item).strip())
        facilities = data.get("facilities_role_patterns") or []
        junk = data.get("junk_role_patterns") or []
        if isinstance(facilities, list) and facilities:
            facilities_pat = "|".join(str(p) for p in facilities if str(p).strip())
        if isinstance(junk, list) and junk:
            junk_pat = "|".join(str(p) for p in junk if str(p).strip())
    return (
        roles,
        re.compile(rf"\b({facilities_pat})\b", re.I),
        re.compile(rf"\b({junk_pat})\b", re.I),
    )


def _decision_role_bundle() -> tuple[tuple[str, ...], re.Pattern[str], re.Pattern[str]]:
    return _load_decision_role_config(str(_project_config_dir() / "decision_roles.yaml"))


def clear_decision_roles_cache() -> None:
    _load_decision_role_config.cache_clear()


def _role_text(*parts: str | None) -> str:
    return " ".join(p.strip() for p in parts if p and p.strip())


def is_junk_role(role: str) -> bool:
    """True for reception / front desk / patient-facing lines — not decision-makers."""
    if not role.strip():
        return False
    _roles, facilities_re, junk_re = _decision_role_bundle()
    del _roles
    if facilities_re.search(role):
        return False
    return bool(junk_re.search(role))


def is_decision_maker_role(role: str) -> bool:
    normalized = role.strip().lower()
    decision_roles, _facilities_re, _junk_re = _decision_role_bundle()
    return bool(
        normalized
        and not is_junk_role(normalized)
        and (
            "manager" in normalized
            or any(token in normalized for token in decision_roles)
        )
    )


def has_atomic_named_decision_maker(enriched: EnrichedLead) -> bool:
    """True for one atomic named DM + local phone — does not check verification_level."""
    best_name = enriched.best_contact_name
    if best_name == NOT_FOUND:
        best_name = ""
    best_role = enriched.best_contact_role
    if best_role == NOT_FOUND:
        best_role = ""
    if (
        best_name.strip()
        and not is_placeholder_name(best_name)
        and is_decision_maker_role(best_role)
        and is_local_callable_phone(enriched.best_contact_phone)
    ):
        return True

    return any(
        contact.name.strip()
        and not is_placeholder_name(contact.name)
        and is_decision_maker_role(contact.label or contact.role)
        and is_local_callable_phone(contact.phone)
        for contact in enriched.site_contacts
    )


def has_verified_named_decision_maker(enriched: EnrichedLead) -> bool:
    """Ready bar: verification_level verified AND atomic named DM + local phone."""
    if (enriched.verification_level or "") != "verified":
        return False
    return has_atomic_named_decision_maker(enriched)


def is_patient_facing_role(role: str, *, property_type: str) -> bool:
    """Backward-compatible alias — junk roles apply beyond medical plazas."""
    del property_type  # junk roles are generalized for all property types
    return is_junk_role(role)


def _investigation_role_text(result: LeadInvestigationResult) -> str:
    parts = [result.contact_role, result.contact_name]
    for contact in result.site_contacts:
        parts.extend([contact.label, contact.name])
    return _role_text(*parts)


def is_patient_facing_investigation(result: LeadInvestigationResult, *, property_type: str) -> bool:
    """True when the only contacts look like junk reception/patient lines."""
    text = _investigation_role_text(result)
    _roles, facilities_re, _junk_re = _decision_role_bundle()
    del _roles, _junk_re
    if facilities_re.search(text):
        return False
    if not is_junk_role(text):
        return False
    # Medical plazas always reject patient/reception-only investigations.
    if property_type == "medical_plaza":
        return True
    # For other types, only reject when every contact is junk (and there is role text).
    if not text.strip():
        return False
    return not any(
        (c.name.strip() or c.label.strip())
        and not is_junk_role(_role_text(c.label, c.name))
        for c in result.site_contacts
    ) or (
        bool(result.contact_role.strip() or result.contact_name.strip())
        and is_junk_role(_role_text(result.contact_role, result.contact_name))
        and not any(
            c.name.strip() and not is_junk_role(_role_text(c.label, c.name))
            for c in result.site_contacts
        )
    )


def requires_named_decision_maker(property_type: str) -> bool:
    return property_type in DM_REQUIRED_PROPERTY_TYPES


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
            raise ValueError(
                f"Invalid min_contact_bar {bar!r} — must be one of {sorted(_BAR_ORDER)}"
            )
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


def is_toll_free_phone(value: str | None) -> bool:
    digits = phone_digits(value)
    if len(digits) != 10:
        return False
    return digits[:3] in _TOLL_FREE_PREFIXES


def is_callable_phone(value: str | None) -> bool:
    if not value or value == NOT_FOUND:
        return False
    if is_placeholder_phone(value):
        return False
    digits = phone_digits(value)
    return len(digits) == 10


def is_local_callable_phone(value: str | None) -> bool:
    """Dialable local phone — rejects placeholders and toll-free corporate locators."""
    return is_callable_phone(value) and not is_toll_free_phone(value)


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
    if is_local_callable_phone(result.contact_phone):
        return True
    return any(is_local_callable_phone(contact.phone) for contact in result.site_contacts)


def _has_labeled_phone(result: LeadInvestigationResult, *, property_type: str = "") -> bool:
    del property_type
    for contact in result.site_contacts:
        if is_local_callable_phone(contact.phone) and (contact.label.strip() or contact.name.strip()):
            role = _role_text(contact.label, contact.name)
            if is_junk_role(role):
                continue
            return True
    if is_local_callable_phone(result.contact_phone) and (
        result.contact_role.strip() or result.contact_name.strip()
    ):
        role = _role_text(result.contact_role, result.contact_name)
        if is_junk_role(role):
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


def has_named_decision_maker_contact(result: LeadInvestigationResult | None) -> bool:
    """True when investigation has a named non-junk contact with a local phone."""
    if result is None:
        return False
    if result.contact_name.strip() and is_local_callable_phone(result.contact_phone):
        if not is_junk_role(_role_text(result.contact_role, result.contact_name)):
            return True
    for contact in result.site_contacts:
        if not contact.name.strip() or not is_local_callable_phone(contact.phone):
            continue
        if is_junk_role(_role_text(contact.label, contact.name)):
            continue
        return True
    return False


def investigation_meets_bar(
    result: LeadInvestigationResult | None,
    rules: EnrichmentRules,
    *,
    property_type: str = "",
) -> tuple[bool, str]:
    if result is None:
        return False, "no Tier 1 result"

    level = _contact_bar_level(result, property_type=property_type)

    # Junk-role rejection applies when we need a callable phone / DM — not for email/form bars.
    if rules.min_contact_bar in ("phone", "labeled_phone") or requires_named_decision_maker(
        property_type
    ):
        if is_patient_facing_investigation(result, property_type=property_type):
            return False, "needs facilities/operations contact, not reception/front-desk line"

    if _BAR_ORDER[level] < _BAR_ORDER[rules.min_contact_bar]:
        return False, f"contact bar is {level}, need {rules.min_contact_bar}"

    if rules.require_property_manager_clue and not has_property_manager_clue(result):
        return False, "missing property manager / ownership clue"

    if requires_named_decision_maker(property_type) and not has_named_decision_maker_contact(result):
        return False, "needs named decision-maker with local phone (Google main line insufficient)"

    return True, f"meets {rules.min_contact_bar} bar"


def enriched_meets_bar(
    enriched: EnrichedLead,
    rules: EnrichmentRules,
) -> tuple[bool, str]:
    level: ContactBar = "form"
    phone = enriched.best_contact_phone
    if phone in ("", NOT_FOUND):
        phone = ""

    # Outreach Google main line alone never satisfies the DM contact bar for CRE.
    google_only = (
        is_local_callable_phone(enriched.main_phone)
        and not is_local_callable_phone(enriched.best_contact_phone)
        and not any(is_local_callable_phone(c.phone) and c.name.strip() for c in enriched.site_contacts)
    )

    if is_local_callable_phone(phone):
        role = enriched.best_contact_role if enriched.best_contact_role != NOT_FOUND else ""
        labeled = bool(role.strip()) or any(
            is_local_callable_phone(c.phone) and (c.label.strip() or c.name.strip())
            for c in enriched.site_contacts
        )
        if labeled and is_junk_role(role):
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

    if requires_named_decision_maker(enriched.property_type):
        named_dm = any(
            c.name.strip()
            and is_local_callable_phone(c.phone)
            and not is_junk_role(_role_text(c.label, c.name))
            for c in enriched.site_contacts
        )
        role = enriched.best_contact_role if enriched.best_contact_role != NOT_FOUND else ""
        # best_contact fields don't always carry a separate name; treat labeled non-junk role
        if (
            role.strip()
            and not is_junk_role(role)
            and is_local_callable_phone(enriched.best_contact_phone)
        ):
            named_dm = True
        if google_only or not named_dm:
            return False, "needs named decision-maker with local phone (Google main line insufficient)"

    return True, f"meets {rules.min_contact_bar} bar"


def sales_gaps_vs_ideal(enriched: EnrichedLead, rules: EnrichmentRules) -> list[str]:
    gaps: list[str] = []
    met, detail = enriched_meets_bar(enriched, rules)
    if not met:
        gaps.append(detail)

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
        # Google main line is outreach-only for CRE — never stop the ladder on it alone.
        if requires_named_decision_maker(raw.property_type) and is_callable_phone(raw.main_phone):
            return True, (
                f"Tier 1 below decision-maker bar (Google main line is outreach-only): {detail}"
            )
        return True, f"Tier 1 below sales contact bar: {detail}"

    if rules.require_property_manager_clue and not has_property_manager_clue(result):
        if requires_named_decision_maker(raw.property_type):
            return True, "missing property manager / ownership clue after Tier 1"
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

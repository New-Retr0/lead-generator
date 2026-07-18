"""Multi-state real-estate license lookup — public government records."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import yaml

from pallares_leads.enrich.search_templates import render_search_template
from pallares_leads.schemas import LeadFact, RawLead

logger = logging.getLogger(__name__)

_DRE_OFFICER = re.compile(
    r"DESIGNATED\s+OFFICER\s+(\d+)\s*[-–—]?\s*Expiration\s+Date:\s*(\d{2}/\d{2}/\d{2,4})\s*\n?\s*"
    r"([A-Z][a-zA-Z'\-]+(?:\s+[A-Z]\.?)?(?:\s+[A-Z][a-zA-Z'\-]+)+)",
    re.I,
)
_DRE_LICENSE_ID = re.compile(r"License\s+ID[:\s]+(\d+)", re.I)
_DRE_STATUS = re.compile(r"License\s+Status[:\s]+([A-Za-z ]+)", re.I)
_DRE_TYPE = re.compile(r"License\s+Type[:\s]+([A-Za-z ]+)", re.I)
_DRE_ADDRESS = re.compile(
    r"Main\s+Office\s+Address[:\s]+([^\n]{10,120})",
    re.I,
)
_GENERIC_LICENSEE = re.compile(
    r"(?:Licensee|Name|Broker)[:\s]+([A-Z][a-zA-Z'\-]+(?:\s+[A-Z]\.?)?(?:\s+[A-Z][a-zA-Z'\-]+)+)",
    re.I,
)
_GENERIC_LICENSE_NO = re.compile(r"(?:License\s*(?:#|Number|ID))[:\s#]*([A-Z0-9\-]+)", re.I)


@dataclass(frozen=True)
class LicenseLookupConfig:
    agency: str = ""
    record_url: str = ""
    search_url: str = ""
    serp_site: str = ""
    pm_license_required: bool = True
    adapter: str = "generic"
    vendor_license: bool = False


@dataclass
class LicenseRecord:
    url: str = ""
    agency: str = ""
    license_id: str = ""
    license_type: str = ""
    status: str = ""
    expiration: str = ""
    designated_officer: str = ""
    officer_license_id: str = ""
    main_office: str = ""
    licensee_name: str = ""
    quotes: dict[str, str] = field(default_factory=dict)

    def has_data(self) -> bool:
        return bool(
            self.designated_officer or self.licensee_name or self.license_id or self.status
        )


@lru_cache(maxsize=1)
def _load_licensing(config_dir: str) -> dict[str, LicenseLookupConfig]:
    path = Path(config_dir) / "licensing.yaml"
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    lookups = data.get("license_lookups") or {}
    result: dict[str, LicenseLookupConfig] = {}
    for state, raw in lookups.items():
        if not isinstance(raw, dict):
            continue
        result[str(state).upper()] = LicenseLookupConfig(
            agency=str(raw.get("agency") or ""),
            record_url=str(raw.get("record_url") or ""),
            search_url=str(raw.get("search_url") or ""),
            serp_site=str(raw.get("serp_site") or ""),
            pm_license_required=bool(raw.get("pm_license_required", True)),
            adapter=str(raw.get("adapter") or "generic"),
            vendor_license=bool(raw.get("vendor_license", False)),
        )
    return result


def lookup_config_for_state(state: str, *, config_dir: Path) -> LicenseLookupConfig | None:
    return _load_licensing(str(config_dir)).get((state or "").upper())


def lookup_config_for_lead(
    raw: RawLead,
    *,
    config_dir: Path,
) -> LicenseLookupConfig | None:
    """DRE for CRE/PM; CSLB for vendor_* categories."""
    if (raw.property_type or "").startswith("vendor_"):
        vendor_key = f"{(raw.state or '').upper()}_CSLB"
        cfg = _load_licensing(str(config_dir)).get(vendor_key)
        if cfg:
            return cfg
    return lookup_config_for_state(raw.state, config_dir=config_dir)


def should_run_license_lookup(
    raw: RawLead,
    *,
    category_key: str,
    has_pm_clue: bool,
    config_dir: Path,
) -> tuple[bool, str]:
    cfg = lookup_config_for_lead(raw, config_dir=config_dir)
    if cfg is None:
        return False, f"no license lookup configured for state {raw.state or 'unknown'}"
    if cfg.adapter == "none":
        return False, f"license adapter disabled for {raw.state}"
    if cfg.vendor_license or (raw.property_type or "").startswith("vendor_"):
        return True, "vendor CSLB / contractor license"
    if not cfg.pm_license_required:
        return False, f"PM license not required in {raw.state}"
    if category_key == "property_manager" or raw.property_type == "property_manager":
        return True, "property_manager category"
    if has_pm_clue:
        return True, "management company clue on lead"
    return False, "not a PM lead"


def find_license_record_url(
    raw: RawLead,
    cfg: LicenseLookupConfig,
    search_web,
    *,
    config_dir: Path,
) -> str | None:
    template = "cslb_license_lookup" if cfg.adapter == "cslb_ca" else "license_lookup"
    query = render_search_template(
        template,
        config_dir=config_dir,
        business_name=raw.business_name,
        city=raw.city,
        state=raw.state,
        serp_site=cfg.serp_site or "gov",
    )
    candidates = search_web(query, limit=5)
    for row in candidates:
        url = row.get("url") if isinstance(row, dict) else str(row)
        if not url:
            continue
        if cfg.serp_site and cfg.serp_site.casefold() in url.casefold():
            return url
        if cfg.record_url and cfg.record_url.casefold() in url.casefold():
            return url
    if cfg.search_url:
        return cfg.search_url
    return None


_CSLB_LICENSE = re.compile(
    r"(?:License(?:\s*Number)?|#)\s*[:#]?\s*(\d{5,8})",
    re.I,
)
_CSLB_BUSINESS = re.compile(
    r"(?:Business\s*Name|Contractor)[:\s]+([A-Z0-9][^\n]{2,80})",
    re.I,
)


def parse_license_record(markdown: str, url: str, cfg: LicenseLookupConfig) -> LicenseRecord:
    record = LicenseRecord(url=url, agency=cfg.agency)
    text = markdown or ""

    if cfg.adapter == "cslb_ca":
        lic = _CSLB_LICENSE.search(text)
        if lic:
            record.license_id = lic.group(1).strip()
        biz = _CSLB_BUSINESS.search(text)
        if biz:
            record.licensee_name = biz.group(1).strip()
            record.quotes["licensee"] = biz.group(0).strip()[:200]
        status = re.search(r"Status[:\s]+([A-Za-z ]+)", text, re.I)
        if status:
            record.status = status.group(1).strip()
        record.license_type = record.license_type or "Contractor"
        return record

    if cfg.adapter == "dre_ca":
        officer_match = _DRE_OFFICER.search(text)
        if officer_match:
            record.officer_license_id = officer_match.group(1).strip()
            record.expiration = officer_match.group(2).strip()
            record.designated_officer = officer_match.group(3).strip()
            record.quotes["designated_officer"] = officer_match.group(0).strip()[:200]

        for pattern, attr in (
            (_DRE_LICENSE_ID, "license_id"),
            (_DRE_STATUS, "status"),
            (_DRE_TYPE, "license_type"),
        ):
            match = pattern.search(text)
            if match:
                setattr(record, attr, match.group(1).strip())

        addr = _DRE_ADDRESS.search(text)
        if addr:
            record.main_office = addr.group(1).strip()
            record.quotes["main_office"] = addr.group(0).strip()[:200]
        return record

    licensee = _GENERIC_LICENSEE.search(text)
    if licensee:
        record.licensee_name = licensee.group(1).strip()
        record.quotes["licensee"] = licensee.group(0).strip()[:200]
    lic_no = _GENERIC_LICENSE_NO.search(text)
    if lic_no:
        record.license_id = lic_no.group(1).strip()
    status = re.search(r"Status[:\s]+([A-Za-z ]+)", text, re.I)
    if status:
        record.status = status.group(1).strip()
    return record


def license_record_to_facts(record: LicenseRecord) -> list[LeadFact]:
    facts: list[LeadFact] = []
    if record.license_id or record.status:
        facts.append(
            LeadFact(
                fact_kind="license",
                value={
                    "agency": record.agency,
                    "license_id": record.license_id,
                    "license_type": record.license_type,
                    "status": record.status,
                    "expiration": record.expiration,
                    "designated_officer": record.designated_officer or record.licensee_name,
                },
                source_kind="state_license",
                source_url=record.url,
                method="deterministic_parse",
                quote=record.quotes.get("designated_officer")
                or record.quotes.get("licensee", ""),
                verification="verified",
            )
        )
    officer = record.designated_officer or record.licensee_name
    if officer:
        facts.append(
            LeadFact(
                fact_kind="person",
                value={
                    "name": officer,
                    "title": "Designated Officer/Broker",
                    "license_id": record.officer_license_id or record.license_id,
                },
                source_kind="state_license",
                source_url=record.url,
                method="deterministic_parse",
                quote=record.quotes.get("designated_officer")
                or record.quotes.get("licensee", officer),
                verification="verified",
            )
        )
    return facts


def license_contacts(record: LicenseRecord) -> list[tuple[str, str, str]]:
    """Return (name, title, quote) tuples for site_contacts merge."""
    officer = record.designated_officer or record.licensee_name
    if not officer:
        return []
    quote = record.quotes.get("designated_officer") or record.quotes.get("licensee", officer)
    return [(officer, "Designated Officer/Broker", quote)]

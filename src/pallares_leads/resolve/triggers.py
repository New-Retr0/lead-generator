"""Recency-decayed trigger signals and per-lead \"why now\" sentences."""

from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING

from pallares_leads.schemas import EnrichedLead, LeadFact

if TYPE_CHECKING:
    pass

_OWNERSHIP_KINDS = frozenset(
    {"ownership_transfer", "deed_transfer", "owner_transfer", "recorder_transfer"}
)
_MGMT_KINDS = frozenset({"management_company", "mgmt_change", "property_manager"})
_BBB_KINDS = frozenset({"registry_rating", "bbb_update", "bbb_complaint"})

_PROPERTY_TICKET_LABELS: dict[str, str] = {
    "parking_large_private": "large private parking lot",
    "parking": "parking lot",
    "strip_mall": "strip mall",
    "shopping_center": "shopping center",
    "industrial": "industrial property",
    "hotel": "hotel",
    "gas_station": "gas station",
}


def _parse_date(value: str) -> date | None:
    if not value or not value.strip():
        return None
    text = value.strip()
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(text[:19], fmt).date()
        except ValueError:
            continue
    iso = text.split("T")[0]
    try:
        return date.fromisoformat(iso)
    except ValueError:
        return None


def _recency_multiplier(age_days: int) -> float:
    if age_days <= 90:
        return 1.0
    if age_days <= 180:
        return 0.7
    if age_days <= 365:
        return 0.4
    return 0.0


def _fact_date(fact: LeadFact) -> date | None:
    for key in ("event_date", "observed_at", "transfer_date", "date"):
        if key in fact.value:
            parsed = _parse_date(fact.value[key])
            if parsed:
                return parsed
    if fact.observed_at:
        return _parse_date(fact.observed_at)
    return None


def _exterior_trigger(enriched: EnrichedLead) -> tuple[int, str, date | None]:
    signals = (enriched.exterior_cleaning_need_signals or "").strip()
    if not signals or signals.lower() in ("not found", "none"):
        return 0, "", None
    first = signals.split(";")[0].split(",")[0].strip()
    if len(first) < 8:
        return 0, "", None
    weight = 10
    return weight, f'Reviews or site text mention exterior issues — "{first[:120]}".', None


def _fact_triggers(enriched: EnrichedLead) -> list[tuple[int, str, date | None]]:
    today = date.today()
    candidates: list[tuple[int, str, date | None]] = []

    for fact in enriched.facts:
        kind = fact.fact_kind.casefold()
        source = fact.source_kind.casefold()
        event_date = _fact_date(fact)

        if kind in _OWNERSHIP_KINDS or (
            kind == "owner_entity" and source in {"county_recorder", "recorder", "deed"}
        ):
            base = 15
            label = fact.value.get("owner_name") or fact.value.get("grantee") or "new owner"
            sentence = f"Property ownership changed — {label}"
            if event_date:
                month = event_date.strftime("%b %Y")
                sentence += f" ({month}); new owners often invest in curb appeal."
            else:
                sentence += "; new owners often invest in curb appeal."
            age = (today - event_date).days if event_date else 0
            score = int(base * _recency_multiplier(age)) if event_date else base
            if score > 0:
                candidates.append((score, sentence, event_date))

        if kind in _MGMT_KINDS or (
            kind == "person" and "property manager" in fact.quote.casefold()
        ):
            base = 8
            name = fact.value.get("name") or fact.value.get("company") or "management company"
            sentence = f"Management contact surfaced — {name}."
            if event_date:
                sentence += f" Updated {event_date.strftime('%b %Y')}."
            age = (today - event_date).days if event_date else 180
            score = int(base * _recency_multiplier(age))
            if score > 0:
                candidates.append((score, sentence, event_date))

        if kind in _BBB_KINDS or (source == "bbb" and kind in {"registry_rating", "complaint"}):
            base = 6
            detail = fact.quote or fact.value.get("rating", "BBB profile activity")
            sentence = f"BBB activity — {detail[:100]}."
            age = (today - event_date).days if event_date else 90
            score = int(base * _recency_multiplier(age))
            if score > 0:
                candidates.append((score, sentence, event_date))

        if source == "state_license" and kind == "license":
            officer = fact.value.get("designated_officer") or fact.value.get("licensee")
            if officer:
                sentence = f"State license on file — designated officer {officer}."
                candidates.append((7, sentence, event_date))

    return candidates


def _fit_fallback(enriched: EnrichedLead) -> str:
    label = _PROPERTY_TICKET_LABELS.get(
        enriched.property_type, enriched.lead_category or enriched.property_type
    )
    ticket_bits: list[str] = [label]
    if enriched.osm_area_m2 and enriched.osm_area_m2 >= 4_000:
        ticket_bits.append("large footprint")
    return (
        f"Strong fit — {' / '.join(ticket_bits)} in {enriched.city}; "
        "no fresh trigger signal in the last 12 months."
    )


def compute_trigger(enriched: EnrichedLead) -> tuple[int, str]:
    """Return (0–15 trigger score, why_now sentence)."""
    candidates: list[tuple[int, str, date | None]] = []

    ext_score, ext_sentence, ext_date = _exterior_trigger(enriched)
    if ext_score:
        candidates.append((ext_score, ext_sentence, ext_date))

    candidates.extend(_fact_triggers(enriched))

    if not candidates:
        return 0, _fit_fallback(enriched)

    best = max(candidates, key=lambda item: item[0])
    return min(best[0], 15), best[1]

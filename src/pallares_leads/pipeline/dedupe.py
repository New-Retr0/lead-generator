from __future__ import annotations

from pallares_leads.schemas import RawLead


def dedupe_by_place_id(leads: list[RawLead]) -> list[RawLead]:
    seen: set[str] = set()
    unique: list[RawLead] = []
    for lead in leads:
        if lead.place_id in seen:
            continue
        seen.add(lead.place_id)
        unique.append(lead)
    return unique

from __future__ import annotations

import csv
from datetime import date
from pathlib import Path

from pallares_leads.schemas import (
    Confidence,
    EnrichedLead,
    InvestigationStatus,
    SalesExportRow,
    SiteContact,
)
from pallares_leads.utils.safe_url import sanitize_csv_cell


def export_csv(leads: list[EnrichedLead], output_path: Path) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    rows = [SalesExportRow.from_enriched(lead) for lead in leads]
    headers = SalesExportRow.csv_headers()

    with output_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        for row in rows:
            dumped = row.model_dump()
            dumped["_place_id"] = dumped.pop("place_id")
            writer.writerow(
                {k: sanitize_csv_cell(str(v)) if v is not None else v for k, v in dumped.items()}
            )

    return output_path


def load_enriched_from_csv(csv_path: Path) -> list[EnrichedLead]:
    """Load leads from a slim sales CSV export."""
    leads: list[EnrichedLead] = []
    with csv_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            return leads

        for row in reader:
            place_id = row.get("_place_id", "")
            if not place_id:
                continue

            status_raw = row.get("status", "")
            inv_status = (
                InvestigationStatus.ENRICHED
                if status_raw == "Ready to call"
                else InvestigationStatus.NEEDS_MANUAL
            )

            contacts_raw = row.get("contacts", "")
            site_contacts: list[SiteContact] = []
            if contacts_raw:
                for line in contacts_raw.splitlines():
                    line = line.strip().lstrip("★").strip()
                    if not line:
                        continue
                    parts = [p.strip() for p in line.split("—")]
                    if (
                        len(parts) >= 2
                        and parts[-1].replace("-", "").replace("(", "").replace(")", "").isdigit()
                    ):
                        site_contacts.append(
                            SiteContact(
                                label=parts[0], phone=parts[-1], name=" — ".join(parts[1:-1]) or ""
                            )
                        )
                    elif len(parts) == 2:
                        site_contacts.append(SiteContact(label=parts[0], phone=parts[1]))
                    else:
                        site_contacts.append(SiteContact(label=line))

            leads.append(
                EnrichedLead(
                    place_id=place_id,
                    business_name=row.get("business", ""),
                    formatted_address=row.get("address", ""),
                    city=row.get("city", ""),
                    state="CA",
                    property_type=row.get("category", "").lower().replace(" ", "_"),
                    lead_category=row.get("category", ""),
                    website=row.get("website") or None,
                    google_maps_url=row.get("maps") or None,
                    main_phone=row.get("phone") or None,
                    best_contact_phone=row.get("phone") or "Not found",
                    site_contacts=site_contacts,
                    contact_source_url=row.get("website") or "Not found",
                    exterior_cleaning_need_signals=row.get("exterior_notes", ""),
                    why_this_is_a_good_fit=row.get("why_call", ""),
                    sales_talking_points=row.get("talking_points", ""),
                    confidence=Confidence(row.get("confidence", "Low")),
                    notes=row.get("notes", ""),
                    investigation_status=inv_status,
                    date_found=date.fromisoformat(row["date"]) if row.get("date") else date.today(),
                )
            )
    return leads

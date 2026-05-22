from __future__ import annotations

import csv
from pathlib import Path

from pallares_leads.schemas import EnrichedLead, ExportRow


def export_csv(leads: list[EnrichedLead], output_path: Path) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    rows = [ExportRow.from_enriched(lead) for lead in leads]
    headers = ExportRow.csv_headers()

    with output_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        for row in rows:
            writer.writerow(row.model_dump())

    return output_path

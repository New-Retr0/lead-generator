from datetime import date

from pallares_leads.pipeline.export_sheets import (
    CHECKBOX_HEADER,
    LINK_COLUMNS,
    SHEETS_HEADERS,
    _column_ranges_excluding,
    _safe_sheet_text,
    normalize_spreadsheet_id,
    row_to_values,
)
from pallares_leads.schemas import EnrichedLead, SalesExportRow


def test_normalize_spreadsheet_id_from_url() -> None:
    url = "https://docs.google.com/spreadsheets/d/1NTJ-tt1kAXHpuCT0oQRJHwqchXi_I1RTsRNkFH9KEzU/edit"
    assert normalize_spreadsheet_id(url) == "1NTJ-tt1kAXHpuCT0oQRJHwqchXi_I1RTsRNkFH9KEzU"


def test_normalize_spreadsheet_id_passthrough() -> None:
    assert normalize_spreadsheet_id("abc123") == "abc123"


def test_row_to_values_leaves_addressed_empty() -> None:
    lead = EnrichedLead(
        place_id="ChIJtest",
        business_name="Test Station",
        formatted_address="123 Main St, Reedley, CA 93654",
        city="Reedley",
        state="CA",
        property_type="gas_station",
        lead_category="Gas Station",
        website="https://example.com",
        google_maps_url="https://maps.google.com/?cid=123",
        main_phone="(559) 638-0100",
        date_found=date(2026, 5, 22),
    )
    values = row_to_values(lead)
    assert values[0] == ""
    assert SHEETS_HEADERS[0] == CHECKBOX_HEADER
    assert values[SHEETS_HEADERS.index("Business")] == "Test Station"
    assert values[SHEETS_HEADERS.index("_place_id")] == "ChIJtest"
    assert values[SHEETS_HEADERS.index("Website")].startswith("=HYPERLINK")
    assert values[SHEETS_HEADERS.index("Maps")].startswith("=HYPERLINK")


def test_row_to_values_escapes_plus_phone() -> None:
    lead = EnrichedLead(
        place_id="ChIJtest",
        business_name="Test",
        formatted_address="123 Main St",
        city="Reedley",
        state="CA",
        property_type="gas_station",
        lead_category="Gas Station",
        main_phone="+1 559-638-5413",
        date_found=date(2026, 5, 22),
    )
    values = row_to_values(lead)
    assert values[SHEETS_HEADERS.index("Phone")] == _safe_sheet_text("+1 559-638-5413")


def test_sales_export_includes_talking_points() -> None:
    lead = EnrichedLead(
        place_id="ChIJtest",
        business_name="Reedley Shopping Center",
        formatted_address="100 Main St, Reedley, CA 93654",
        city="Reedley",
        state="CA",
        property_type="shopping_center",
        lead_category="Shopping Center",
        why_this_is_a_good_fit="High-traffic retail hub on main corridor.",
        sales_talking_points="• Near downtown Reedley\n• Mixed tenant mix with food anchors",
        lead_score=70,
        date_found=date(2026, 5, 22),
    )
    row = SalesExportRow.from_enriched(lead)
    assert row.why_call == "High-traffic retail hub on main corridor."
    assert "downtown Reedley" in row.talking_points
    assert SHEETS_HEADERS.index("Talking Points") == SHEETS_HEADERS.index("Why Call") + 1
    assert SHEETS_HEADERS.index("Score") == SHEETS_HEADERS.index("Confidence") + 1


def test_sales_export_prepends_why_now_to_why_call() -> None:
    lead = EnrichedLead(
        place_id="ChIJwhy",
        business_name="Reedley Plaza",
        formatted_address="100 Main St, Reedley, CA 93654",
        city="Reedley",
        state="CA",
        property_type="strip_mall",
        lead_category="Strip Mall",
        why_now="Property changed hands recently; new owners invest in curb appeal.",
        why_this_is_a_good_fit="Strong fit for exterior cleaning.",
        lead_score=65,
        date_found=date(2026, 5, 22),
    )
    row = SalesExportRow.from_enriched(lead)
    assert row.why_call.startswith("Property changed hands recently")
    assert "Strong fit for exterior cleaning." in row.why_call


def test_sales_export_has_only_slim_columns() -> None:
    headers = SalesExportRow.csv_headers()
    assert len(headers) == 18
    assert "score" in headers
    assert headers[-1] == "_place_id"
    assert "contact" not in headers
    assert "role" not in headers
    assert "property_manager" not in headers
    assert "contacts" in headers
    col_count = len(SHEETS_HEADERS)
    ranges = _column_ranges_excluding(set(LINK_COLUMNS), col_count)
    covered = [col for start, end in ranges for col in range(start, end)]
    for link_col in LINK_COLUMNS:
        assert link_col not in covered
    assert covered == [c for c in range(col_count) if c not in LINK_COLUMNS]

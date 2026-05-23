from __future__ import annotations

import logging
import re
from typing import Any

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from pallares_leads.enrich.domain_verify import scrub_unverified_website
from pallares_leads.schemas import EnrichedLead, SalesExportRow
from pallares_leads.settings import Settings

logger = logging.getLogger(__name__)

SCOPES = ("https://www.googleapis.com/auth/spreadsheets",)
DEFAULT_SHEET_NAME = "Leads"
CHECKBOX_HEADER = "Addressed"
PLACE_ID_HEADER = "_place_id"
BUSINESS_NAME_HEADER = "Business"

# Applied on every export — matches your sheet styling (Exo 2, 12pt)
SHEET_FONT_FAMILY = "Exo 2"
SHEET_FONT_SIZE = 12

# Human-readable headers for sales outreach
SHEETS_HEADERS: list[str] = [
    "Addressed",
    "Confidence",
    "Status",
    "Date",
    "Business",
    "Category",
    "City",
    "Address",
    "Phone",
    "Contacts",
    "Why Call",
    "Talking Points",
    "Exterior Notes",
    "Website",
    "Maps",
    "Notes",
    "_place_id",
]

# Maps internal SalesExportRow field → sheet header
_FIELD_TO_HEADER: dict[str, str] = {
    "addressed": "Addressed",
    "confidence": "Confidence",
    "status": "Status",
    "date": "Date",
    "business": "Business",
    "category": "Category",
    "city": "City",
    "address": "Address",
    "phone": "Phone",
    "contacts": "Contacts",
    "why_call": "Why Call",
    "talking_points": "Talking Points",
    "exterior_notes": "Exterior Notes",
    "website": "Website",
    "maps": "Maps",
    "notes": "Notes",
    "place_id": "_place_id",
}

# Column widths in pixels — sized so header labels stay on one line (Exo 2, 12pt bold)
COLUMN_WIDTHS: list[int] = [
    110,  # Addressed
    115,  # Confidence
    130,  # Status
    100,  # Date
    200,  # Business
    150,  # Category
    110,  # City
    280,  # Address
    130,  # Phone
    320,  # Contacts
    260,  # Why Call
    340,  # Talking Points
    180,  # Exterior Notes
    90,   # Website
    90,   # Maps
    220,  # Notes
    120,  # _place_id (hidden)
]

# Column indices for typed / aligned formatting
COL_CHECKBOX = 0
COL_CONFIDENCE = 1
COL_STATUS = 2
COL_DATE = 3
COL_PHONE = 8
COL_WEBSITE = 13
COL_MAPS = 14
LINK_COLUMNS = (COL_WEBSITE, COL_MAPS)
HEADER_ROW_HEIGHT = 42
DATA_ROW_HEIGHT = 28

# Google Sheets default link blue
LINK_FOREGROUND = {"red": 0.06, "green": 0.33, "blue": 0.8}


def _column_ranges_excluding(skip: set[int], col_count: int) -> list[tuple[int, int]]:
    """Contiguous column spans omitting indices in *skip*."""
    ranges: list[tuple[int, int]] = []
    start = 0
    for col in range(col_count):
        if col in skip:
            if start < col:
                ranges.append((start, col))
            start = col + 1
    if start < col_count:
        ranges.append((start, col_count))
    return ranges

_SPREADSHEET_ID_RE = re.compile(r"/spreadsheets/d/([a-zA-Z0-9-_]+)")


def normalize_spreadsheet_id(value: str) -> str:
    value = value.strip()
    match = _SPREADSHEET_ID_RE.search(value)
    if match:
        return match.group(1)
    if "/d/" in value:
        return value.split("/d/", 1)[1].split("/")[0]
    return value


def sheets_configured(settings: Settings) -> bool:
    return bool(settings.google_sheets_spreadsheet_id and settings.google_service_account_json)


def _service_account_path(settings: Settings):
    path = settings.service_account_path()
    if not path.is_file():
        raise FileNotFoundError(f"Service account JSON not found: {path}")
    return path


def _build_service(settings: Settings):
    creds = service_account.Credentials.from_service_account_file(
        str(_service_account_path(settings)),
        scopes=SCOPES,
    )
    return build("sheets", "v4", credentials=creds, cache_discovery=False)


def _sheet_tab(settings: Settings) -> str:
    return settings.google_sheets_tab_name or DEFAULT_SHEET_NAME


def _safe_sheet_text(value: str) -> str:
    """Prevent #ERROR! when Sheets interprets +1 phones or @emails as formulas."""
    if not value:
        return ""
    text = str(value)
    if text[0] in ("=", "+", "-", "@"):
        return f"'{text}"
    return text


def _hyperlink(url: str, label: str) -> str:
    if not url or url.startswith("="):
        return ""
    escaped = url.replace('"', '""')
    return f'=HYPERLINK("{escaped}","{label}")'


def row_to_values(lead: EnrichedLead) -> list[str]:
    export = SalesExportRow.from_enriched(lead)
    data = export.model_dump()

    link_labels = {
        "Website": ("Site", export.website),
        "Maps": ("Map", export.maps),
    }

    values: list[str] = []
    for header in SHEETS_HEADERS:
        if header == CHECKBOX_HEADER:
            values.append("")
            continue

        if header in link_labels:
            label, url = link_labels[header]
            values.append(_hyperlink(url, label) if url else "")
            continue

        field = next((k for k, v in _FIELD_TO_HEADER.items() if v == header), None)
        raw = str(data.get(field, "")) if field else ""
        values.append(_safe_sheet_text(raw))

    return values


def _col_letter(index: int) -> str:
    result = ""
    n = index + 1
    while n:
        n, rem = divmod(n - 1, 26)
        result = chr(65 + rem) + result
    return result


class SheetsExporter:
    def __init__(self, settings: Settings) -> None:
        if not sheets_configured(settings):
            raise ValueError("Google Sheets is not configured")
        self._settings = settings
        self._spreadsheet_id = normalize_spreadsheet_id(settings.google_sheets_spreadsheet_id)
        self._preferred_tab = _sheet_tab(settings)
        self._tab: str | None = None
        self._sheet_id: int | None = None
        self._service = _build_service(settings)

    def _resolve_sheet(self) -> tuple[int, str]:
        if self._sheet_id is not None and self._tab is not None:
            return self._sheet_id, self._tab

        meta = (
            self._service.spreadsheets()
            .get(spreadsheetId=self._spreadsheet_id, fields="sheets.properties")
            .execute()
        )
        sheets = meta.get("sheets", [])
        if not sheets:
            raise ValueError("Spreadsheet has no tabs")

        for sheet in sheets:
            props = sheet.get("properties", {})
            if props.get("title") == self._preferred_tab:
                self._sheet_id = int(props["sheetId"])
                self._tab = str(props["title"])
                return self._sheet_id, self._tab

        props = sheets[0]["properties"]
        self._sheet_id = int(props["sheetId"])
        self._tab = str(props["title"])
        logger.info("Tab %r not found — using first tab %r", self._preferred_tab, self._tab)
        return self._sheet_id, self._tab

    def health_check(self) -> tuple[bool, str]:
        try:
            meta = (
                self._service.spreadsheets()
                .get(spreadsheetId=self._spreadsheet_id, fields="properties.title")
                .execute()
            )
            title = meta.get("properties", {}).get("title", "spreadsheet")
            return True, f"OK — {title!r}"
        except HttpError as exc:
            return False, f"HTTP {exc.resp.status}: {exc.reason}"
        except OSError as exc:
            return False, str(exc)

    def _read_header_row(self) -> list[str]:
        _, tab = self._resolve_sheet()
        result = (
            self._service.spreadsheets()
            .values()
            .get(spreadsheetId=self._spreadsheet_id, range=f"{tab}!1:1")
            .execute()
        )
        rows = result.get("values", [])
        return [str(c) for c in rows[0]] if rows else []

    def _read_data_grid(self) -> list[list[str]]:
        _, tab = self._resolve_sheet()
        end_col = _col_letter(len(SHEETS_HEADERS) - 1)
        result = (
            self._service.spreadsheets()
            .values()
            .get(spreadsheetId=self._spreadsheet_id, range=f"{tab}!A2:{end_col}")
            .execute()
        )
        return result.get("values", [])

    def _sheet_grid_column_count(self, sheet_id: int) -> int:
        meta = (
            self._service.spreadsheets()
            .get(spreadsheetId=self._spreadsheet_id, fields="sheets.properties")
            .execute()
        )
        for sheet in meta.get("sheets", []):
            props = sheet.get("properties", {})
            if props.get("sheetId") == sheet_id:
                return int(props.get("gridProperties", {}).get("columnCount", 0))
        return 0

    def _trim_trailing_columns(self, sheet_id: int) -> None:
        """Remove legacy columns from the old full-schema export (V+)."""
        col_count = len(SHEETS_HEADERS)
        grid_cols = self._sheet_grid_column_count(sheet_id)
        if grid_cols <= col_count:
            return

        try:
            self._service.spreadsheets().batchUpdate(
                spreadsheetId=self._spreadsheet_id,
                body={
                    "requests": [
                        {
                            "deleteDimension": {
                                "range": {
                                    "sheetId": sheet_id,
                                    "dimension": "COLUMNS",
                                    "startIndex": col_count,
                                    "endIndex": grid_cols,
                                }
                            }
                        }
                    ]
                },
            ).execute()
            logger.info("Removed %d stale sheet column(s)", grid_cols - col_count)
        except HttpError as exc:
            logger.warning("Could not trim stale sheet columns: %s", exc.reason)

    def _read_existing_place_ids(self, header: list[str]) -> set[str]:
        if PLACE_ID_HEADER not in header or BUSINESS_NAME_HEADER not in header:
            return set()
        name_idx = header.index(BUSINESS_NAME_HEADER)
        id_idx = header.index(PLACE_ID_HEADER)
        ids: set[str] = set()
        for row in self._read_data_grid():
            name = row[name_idx] if len(row) > name_idx else ""
            place_id = row[id_idx] if len(row) > id_idx else ""
            if str(name).strip() and str(place_id).strip():
                ids.add(str(place_id).strip())
        return ids

    def _next_data_row(self, header: list[str]) -> int:
        name_idx = header.index(BUSINESS_NAME_HEADER)
        grid = self._read_data_grid()
        for i in range(len(grid) - 1, -1, -1):
            row = grid[i]
            name = row[name_idx] if len(row) > name_idx else ""
            if str(name).strip():
                return i + 3
        return 2

    def _clear_data_rows(self) -> None:
        _, tab = self._resolve_sheet()
        end_col = _col_letter(len(SHEETS_HEADERS) - 1)
        self._service.spreadsheets().values().clear(
            spreadsheetId=self._spreadsheet_id,
            range=f"{tab}!A2:{end_col}",
        ).execute()

    def _ensure_headers(self, sheet_id: int) -> None:
        header = self._read_header_row()
        col_count = len(SHEETS_HEADERS)
        needs_header = header[:col_count] != SHEETS_HEADERS

        if needs_header:
            end_col = _col_letter(col_count - 1)
            _, tab = self._resolve_sheet()
            self._service.spreadsheets().values().update(
                spreadsheetId=self._spreadsheet_id,
                range=f"{tab}!A1:{end_col}1",
                valueInputOption="RAW",
                body={"values": [SHEETS_HEADERS]},
            ).execute()
            logger.info("Initialized Google Sheets header row on tab %r", tab)

        self._trim_trailing_columns(sheet_id)

    def _apply_sheet_formatting(
        self, sheet_id: int, *, data_rows: int = 1000, full_setup: bool = False
    ) -> None:
        col_count = len(SHEETS_HEADERS)
        row_end = max(data_rows, 100)

        core_requests: list[dict[str, Any]] = [
            {
                "updateSheetProperties": {
                    "properties": {
                        "sheetId": sheet_id,
                        "gridProperties": {"frozenRowCount": 1},
                    },
                    "fields": "gridProperties.frozenRowCount",
                }
            },
            {
                "updateDimensionProperties": {
                    "range": {
                        "sheetId": sheet_id,
                        "dimension": "ROWS",
                        "startIndex": 0,
                        "endIndex": 1,
                    },
                    "properties": {"pixelSize": HEADER_ROW_HEIGHT},
                    "fields": "pixelSize",
                }
            },
            {
                "repeatCell": {
                    "range": {
                        "sheetId": sheet_id,
                        "startRowIndex": 0,
                        "endRowIndex": 1,
                        "startColumnIndex": 0,
                        "endColumnIndex": col_count,
                    },
                    "cell": {
                        "userEnteredFormat": {
                            "backgroundColor": {"red": 0.12, "green": 0.23, "blue": 0.37},
                            "textFormat": {
                                "fontFamily": SHEET_FONT_FAMILY,
                                "fontSize": SHEET_FONT_SIZE,
                                "bold": True,
                                "foregroundColor": {"red": 1, "green": 1, "blue": 1},
                            },
                            "horizontalAlignment": "CENTER",
                            "verticalAlignment": "MIDDLE",
                            "wrapStrategy": "CLIP",
                        }
                    },
                    "fields": (
                        "userEnteredFormat(backgroundColor,textFormat,"
                        "horizontalAlignment,verticalAlignment,wrapStrategy)"
                    ),
                }
            },
            {
                "repeatCell": {
                    "range": {
                        "sheetId": sheet_id,
                        "startRowIndex": 1,
                        "endRowIndex": row_end,
                        "startColumnIndex": 0,
                        "endColumnIndex": col_count,
                    },
                    "cell": {
                        "userEnteredFormat": {
                            "wrapStrategy": "WRAP",
                            "verticalAlignment": "TOP",
                        }
                    },
                    "fields": "userEnteredFormat(wrapStrategy,verticalAlignment)",
                }
            },
        ]

        # Bold body text — skip link columns so HYPERLINK styling is not overwritten
        for col_start, col_end in _column_ranges_excluding(set(LINK_COLUMNS), col_count):
            core_requests.append(
                {
                    "repeatCell": {
                        "range": {
                            "sheetId": sheet_id,
                            "startRowIndex": 1,
                            "endRowIndex": row_end,
                            "startColumnIndex": col_start,
                            "endColumnIndex": col_end,
                        },
                        "cell": {
                            "userEnteredFormat": {
                                "textFormat": {
                                    "fontFamily": SHEET_FONT_FAMILY,
                                    "fontSize": SHEET_FONT_SIZE,
                                    "bold": True,
                                },
                            },
                        },
                        "fields": "userEnteredFormat.textFormat",
                    }
                }
            )

        core_requests.append(
            {
                "setBasicFilter": {
                    "filter": {
                        "range": {
                            "sheetId": sheet_id,
                            "startRowIndex": 0,
                            "endRowIndex": max(data_rows + 1, 1000),
                            "startColumnIndex": 0,
                            "endColumnIndex": col_count,
                        }
                    }
                }
            }
        )

        for idx, width in enumerate(COLUMN_WIDTHS):
            core_requests.append(
                {
                    "updateDimensionProperties": {
                        "range": {
                            "sheetId": sheet_id,
                            "dimension": "COLUMNS",
                            "startIndex": idx,
                            "endIndex": idx + 1,
                        },
                        "properties": {"pixelSize": width},
                        "fields": "pixelSize",
                    }
                }
            )

        core_requests.append(
            {
                "updateDimensionProperties": {
                    "range": {
                        "sheetId": sheet_id,
                        "dimension": "COLUMNS",
                        "startIndex": col_count - 1,
                        "endIndex": col_count,
                    },
                    "properties": {"hiddenByUser": True},
                    "fields": "hiddenByUser",
                }
            }
        )

        # Center short columns; phone as text so Sheets doesn't mangle numbers
        for col_idx in (
            COL_CHECKBOX,
            COL_CONFIDENCE,
            COL_STATUS,
            COL_DATE,
            *LINK_COLUMNS,
        ):
            core_requests.append(
                {
                    "repeatCell": {
                        "range": {
                            "sheetId": sheet_id,
                            "startRowIndex": 1,
                            "endRowIndex": row_end,
                            "startColumnIndex": col_idx,
                            "endColumnIndex": col_idx + 1,
                        },
                        "cell": {
                            "userEnteredFormat": {"horizontalAlignment": "CENTER"},
                        },
                        "fields": "userEnteredFormat.horizontalAlignment",
                    }
                }
            )

        core_requests.append(
            {
                "repeatCell": {
                    "range": {
                        "sheetId": sheet_id,
                        "startRowIndex": 1,
                        "endRowIndex": row_end,
                        "startColumnIndex": COL_PHONE,
                        "endColumnIndex": COL_PHONE + 1,
                    },
                    "cell": {
                        "userEnteredFormat": {
                            "numberFormat": {"type": "TEXT"},
                            "horizontalAlignment": "LEFT",
                        }
                    },
                    "fields": "userEnteredFormat(numberFormat,horizontalAlignment)",
                }
            }
        )

        core_requests.append(
            {
                "repeatCell": {
                    "range": {
                        "sheetId": sheet_id,
                        "startRowIndex": 1,
                        "endRowIndex": row_end,
                        "startColumnIndex": COL_DATE,
                        "endColumnIndex": COL_DATE + 1,
                    },
                    "cell": {
                        "userEnteredFormat": {
                            "numberFormat": {"type": "DATE", "pattern": "yyyy-mm-dd"},
                        }
                    },
                    "fields": "userEnteredFormat.numberFormat",
                }
            }
        )

        try:
            self._service.spreadsheets().batchUpdate(
                spreadsheetId=self._spreadsheet_id,
                body={"requests": core_requests},
            ).execute()
        except HttpError as exc:
            logger.warning("Sheet core formatting failed: %s", exc.reason)

        if not full_setup:
            return

        decoration_requests: list[dict[str, Any]] = [
            {
                "addBanding": {
                    "bandedRange": {
                        "range": {
                            "sheetId": sheet_id,
                            "startRowIndex": 1,
                            "endRowIndex": max(data_rows + 1, 100),
                            "startColumnIndex": 0,
                            "endColumnIndex": col_count,
                        },
                        "rowProperties": {
                            "firstBandColor": {"red": 1, "green": 1, "blue": 1},
                            "secondBandColor": {"red": 0.95, "green": 0.97, "blue": 0.99},
                        },
                    }
                }
            },
            {
                "addConditionalFormatRule": {
                    "rule": {
                        "ranges": [
                            {
                                "sheetId": sheet_id,
                                "startRowIndex": 1,
                                "startColumnIndex": COL_CONFIDENCE,
                                "endColumnIndex": COL_CONFIDENCE + 1,
                            }
                        ],
                        "booleanRule": {
                            "condition": {
                                "type": "TEXT_EQ",
                                "values": [{"userEnteredValue": "High"}],
                            },
                            "format": {
                                "backgroundColor": {"red": 0.85, "green": 0.95, "blue": 0.85},
                            },
                        },
                    },
                    "index": 0,
                }
            },
            {
                "addConditionalFormatRule": {
                    "rule": {
                        "ranges": [
                            {
                                "sheetId": sheet_id,
                                "startRowIndex": 1,
                                "startColumnIndex": COL_CONFIDENCE,
                                "endColumnIndex": COL_CONFIDENCE + 1,
                            }
                        ],
                        "booleanRule": {
                            "condition": {
                                "type": "TEXT_EQ",
                                "values": [{"userEnteredValue": "Low"}],
                            },
                            "format": {
                                "backgroundColor": {"red": 1, "green": 0.95, "blue": 0.8},
                            },
                        },
                    },
                    "index": 1,
                }
            },
            {
                "addConditionalFormatRule": {
                    "rule": {
                        "ranges": [
                            {
                                "sheetId": sheet_id,
                                "startRowIndex": 1,
                                "startColumnIndex": COL_STATUS,
                                "endColumnIndex": COL_STATUS + 1,
                            }
                        ],
                        "booleanRule": {
                            "condition": {
                                "type": "TEXT_EQ",
                                "values": [{"userEnteredValue": "Needs research"}],
                            },
                            "format": {
                                "textFormat": {
                                    "foregroundColor": {"red": 0.85, "green": 0.45, "blue": 0.1},
                                },
                            },
                        },
                    },
                    "index": 2,
                }
            },
        ]

        try:
            self._service.spreadsheets().batchUpdate(
                spreadsheetId=self._spreadsheet_id,
                body={"requests": decoration_requests},
            ).execute()
        except HttpError as exc:
            logger.warning("Sheet decoration formatting skipped: %s", exc.reason)

    def _apply_row_checkboxes(self, sheet_id: int, start_row: int, end_row: int) -> None:
        self._service.spreadsheets().batchUpdate(
            spreadsheetId=self._spreadsheet_id,
            body={
                "requests": [
                    {
                        "setDataValidation": {
                            "range": {
                                "sheetId": sheet_id,
                                "startRowIndex": start_row - 1,
                                "endRowIndex": end_row,
                                "startColumnIndex": 0,
                                "endColumnIndex": 1,
                            },
                            "rule": {
                                "condition": {"type": "BOOLEAN"},
                                "showCustomUi": True,
                                "strict": False,
                            },
                        }
                    }
                ]
            },
        ).execute()

    def _apply_row_hyperlinks(
        self, sheet_id: int, start_row: int, leads: list[EnrichedLead]
    ) -> None:
        """Write HYPERLINK formulas with link styling — must run after sheet formatting."""
        requests: list[dict[str, Any]] = []
        for offset, lead in enumerate(leads):
            export = SalesExportRow.from_enriched(lead)
            row_index = start_row - 1 + offset
            for col_index, url, label in (
                (COL_WEBSITE, export.website, "Site"),
                (COL_MAPS, export.maps, "Map"),
            ):
                if not url:
                    continue
                requests.append(
                    {
                        "updateCells": {
                            "range": {
                                "sheetId": sheet_id,
                                "startRowIndex": row_index,
                                "endRowIndex": row_index + 1,
                                "startColumnIndex": col_index,
                                "endColumnIndex": col_index + 1,
                            },
                            "rows": [
                                {
                                    "values": [
                                        {
                                            "userEnteredValue": {
                                                "formulaValue": _hyperlink(url, label)
                                            },
                                            "userEnteredFormat": {
                                                "textFormat": {
                                                    "fontFamily": SHEET_FONT_FAMILY,
                                                    "fontSize": SHEET_FONT_SIZE,
                                                    "bold": False,
                                                    "underline": True,
                                                    "foregroundColor": LINK_FOREGROUND,
                                                },
                                                "horizontalAlignment": "CENTER",
                                                "verticalAlignment": "TOP",
                                            },
                                        }
                                    ]
                                }
                            ],
                            "fields": "userEnteredValue,userEnteredFormat",
                        }
                    }
                )

        if not requests:
            return

        try:
            self._service.spreadsheets().batchUpdate(
                spreadsheetId=self._spreadsheet_id,
                body={"requests": requests},
            ).execute()
        except HttpError as exc:
            logger.warning("Row hyperlink styling failed: %s", exc.reason)

    def _write_rows(self, tab: str, start_row: int, values: list[list[str]]) -> None:
        end_col = _col_letter(len(SHEETS_HEADERS) - 1)
        end_row = start_row + len(values) - 1
        self._service.spreadsheets().values().update(
            spreadsheetId=self._spreadsheet_id,
            range=f"{tab}!A{start_row}:{end_col}{end_row}",
            valueInputOption="USER_ENTERED",
            body={"values": values},
        ).execute()

    def _sort_data(self, sheet_id: int, row_count: int) -> None:
        if row_count < 2:
            return
        self._service.spreadsheets().batchUpdate(
            spreadsheetId=self._spreadsheet_id,
            body={
                "requests": [
                    {
                        "sortRange": {
                            "range": {
                                "sheetId": sheet_id,
                                "startRowIndex": 1,
                                "endRowIndex": row_count,
                                "startColumnIndex": 0,
                                "endColumnIndex": len(SHEETS_HEADERS),
                            },
                            "sortSpecs": [
                                {"dimensionIndex": 5, "sortOrder": "ASCENDING"},  # Category
                                {"dimensionIndex": 6, "sortOrder": "ASCENDING"},  # City
                                {"dimensionIndex": 4, "sortOrder": "ASCENDING"},  # Business
                                {"dimensionIndex": 1, "sortOrder": "DESCENDING"},  # Confidence
                            ],
                        }
                    }
                ]
            },
        ).execute()

    def export_leads(self, leads: list[EnrichedLead], *, rewrite: bool = False) -> int:
        if not leads:
            return 0

        sheet_id, tab = self._resolve_sheet()
        self._ensure_headers(sheet_id)

        header = self._read_header_row()
        if rewrite:
            self._clear_data_rows()
            self._trim_trailing_columns(sheet_id)
            existing: set[str] = set()
            start_row = 2
        else:
            existing = self._read_existing_place_ids(header)
            start_row = self._next_data_row(header)

        new_leads = [lead for lead in leads if lead.place_id not in existing]
        if not new_leads and not rewrite:
            logger.info("Google Sheets: all %d leads already present — nothing to write", len(leads))
            self._apply_sheet_formatting(sheet_id, data_rows=start_row + 5, full_setup=True)
            return 0

        if rewrite:
            new_leads = [scrub_unverified_website(lead, verify_evidence=False) for lead in leads]
        else:
            new_leads = [scrub_unverified_website(lead, verify_evidence=False) for lead in new_leads]

        values = [row_to_values(lead) for lead in new_leads]
        self._write_rows(tab, start_row, values)
        end_row = start_row + len(values) - 1
        self._apply_row_checkboxes(sheet_id, start_row, end_row)
        self._apply_sheet_formatting(
            sheet_id,
            data_rows=end_row + 10,
            full_setup=True,
        )
        self._apply_row_hyperlinks(sheet_id, start_row, new_leads)

        if rewrite:
            self._sort_data(sheet_id, end_row + 1)
            # Sort moves rows but keeps per-cell formulas; re-apply link styling in case
            # banding or conditional rules touched link columns on some setups.
            self._apply_row_hyperlinks(sheet_id, start_row, new_leads)

        logger.info(
            "Google Sheets: wrote %d new leads at row %d (%d skipped as duplicates)",
            len(new_leads),
            start_row,
            len(leads) - len(new_leads),
        )
        return len(new_leads)


def export_sheets(leads: list[EnrichedLead], settings: Settings, *, rewrite: bool = False) -> int:
    return SheetsExporter(settings).export_leads(leads, rewrite=rewrite)


def import_feedback_from_sheets(settings: Settings) -> list[dict[str, str]]:
    """Read Addressed checkbox + Notes from Google Sheets for sales calibration."""
    if not sheets_configured(settings):
        raise ValueError("Google Sheets not configured")
    exporter = SheetsExporter(settings)
    sheet_id, _tab = exporter._resolve_sheet()
    header = exporter._read_header_row()
    if not header:
        return []

    try:
        col_count = len(header)
        end_col = _col_letter(col_count - 1)
        result = exporter._service.spreadsheets().values().get(
            spreadsheetId=sheet_id,
            range=f"{_sheet_tab(settings)}!A2:{end_col}",
        ).execute()
    except HttpError as exc:
        raise ValueError(f"Failed to read sheet: {exc}") from exc

    rows = result.get("values") or []
    addressed_idx = header.index(CHECKBOX_HEADER) if CHECKBOX_HEADER in header else None
    notes_idx = header.index("Notes") if "Notes" in header else None
    place_idx = header.index(PLACE_ID_HEADER) if PLACE_ID_HEADER in header else None
    status_idx = header.index("Status") if "Status" in header else None

    feedback: list[dict[str, str]] = []
    for row in rows:
        if place_idx is None or place_idx >= len(row):
            continue
        place_id = row[place_idx].strip()
        if not place_id:
            continue
        addressed = ""
        if addressed_idx is not None and addressed_idx < len(row):
            addressed = row[addressed_idx].strip().upper()
        notes = ""
        if notes_idx is not None and notes_idx < len(row):
            notes = row[notes_idx].strip()
        status = ""
        if status_idx is not None and status_idx < len(row):
            status = row[status_idx].strip()
        feedback.append(
            {
                "place_id": place_id,
                "addressed": addressed in ("TRUE", "YES", "1", "X"),
                "notes": notes,
                "status": status,
            }
        )
    return feedback


def sheets_health_check(settings: Settings) -> tuple[bool, str]:
    if not settings.google_sheets_spreadsheet_id:
        return False, "missing GOOGLE_SHEETS_SPREADSHEET_ID"
    if not settings.google_service_account_json:
        return False, "missing GOOGLE_SERVICE_ACCOUNT_JSON"
    try:
        return SheetsExporter(settings).health_check()
    except FileNotFoundError as exc:
        return False, str(exc)
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)

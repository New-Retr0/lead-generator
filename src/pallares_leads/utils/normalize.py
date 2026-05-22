from __future__ import annotations

import re

_US_PHONE = re.compile(
    r"(?:\+1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}"
)
_EMAIL = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
_ZIP = re.compile(r"\b(\d{5})(?:-\d{4})?\b")


def normalize_phone(raw: str | None) -> str | None:
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10:
        return raw.strip()
    return f"({digits[0:3]}) {digits[3:6]}-{digits[6:10]}"


def parse_city_state_zip(formatted_address: str, fallback_city: str, fallback_state: str) -> tuple[str, str, str]:
    """Best-effort parse from Google formatted address."""
    city = fallback_city
    state = fallback_state
    zip_code = ""

    parts = [p.strip() for p in formatted_address.split(",")]
    if len(parts) >= 2:
        last = parts[-1]
        zip_match = _ZIP.search(last)
        if zip_match:
            zip_code = zip_match.group(1)
        state_match = re.search(r"\b([A-Z]{2})\b", last)
        if state_match:
            state = state_match.group(1)
        if len(parts) >= 3:
            city = parts[-2]

    return city, state, zip_code


def normalize_website(url: str | None) -> str | None:
    if not url:
        return None
    url = url.strip()
    if not url.startswith(("http://", "https://")):
        url = f"https://{url}"
    return url.rstrip("/")


def extract_phones(text: str) -> list[str]:
    seen: set[str] = set()
    phones: list[str] = []
    for match in _US_PHONE.findall(text):
        normalized = normalize_phone(match)
        if normalized and normalized not in seen:
            seen.add(normalized)
            phones.append(normalized)
    return phones


def extract_emails(text: str) -> list[str]:
    seen: set[str] = set()
    emails: list[str] = []
    for match in _EMAIL.findall(text):
        lower = match.lower()
        if lower not in seen and not lower.endswith((".png", ".jpg", ".gif", ".svg")):
            seen.add(lower)
            emails.append(lower)
    return emails


def slugify(value: str) -> str:
    value = value.lower().strip()
    value = re.sub(r"[^\w\s-]", "", value)
    return re.sub(r"[-\s]+", "-", value).strip("-")

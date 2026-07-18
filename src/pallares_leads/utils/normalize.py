from __future__ import annotations

import re
import unicodedata

_US_PHONE = re.compile(r"(?:\+1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}")
_EMAIL = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
_ZIP = re.compile(r"\b(\d{5})(?:-\d{4})?\b")

_PLACEHOLDER_PHRASES = frozenset(
    {
        "not specified",
        "not found",
        "unknown",
        "n/a",
        "na",
        "none",
        "unavailable",
        "tbd",
        "see website",
    }
)


def phone_digits(raw: str | None) -> str:
    if not raw:
        return ""
    digits = re.sub(r"\D", "", raw.strip())
    if len(digits) == 11 and digits.startswith("1"):
        return digits[1:]
    return digits


def is_placeholder_phone(raw: str | None) -> bool:
    if not raw:
        return True
    text = raw.strip().lower()
    if not text or text in _PLACEHOLDER_PHRASES:
        return True
    if any(phrase in text for phrase in _PLACEHOLDER_PHRASES if len(phrase) > 3):
        return True

    digits = phone_digits(raw)
    if len(digits) != 10:
        return True

    area, exchange, _line = digits[:3], digits[3:6], digits[6:]
    if area in {"000", "111", "555"} or exchange in {"000", "555"}:
        return True
    if digits in {"1234567890", "0123456789", "0000000000"}:
        return True
    if len(set(digits)) == 1:
        return True
    return False


def is_valid_phone_format(raw: str | None) -> bool:
    return len(phone_digits(raw)) == 10


def phone_quality_score(
    raw: str | None,
    *,
    source: str = "scrape",
    labeled: bool = False,
) -> int:
    """Higher is better. Google Places > labeled scrape > unlabeled scrape."""
    if is_placeholder_phone(raw) or not is_valid_phone_format(raw):
        return 0
    if source == "google":
        return 4
    if labeled:
        return 3
    return 2


def pick_best_phone(
    google_phone: str | None,
    *candidates: tuple[str | None, str, bool],
) -> str | None:
    """Pick highest-quality callable phone; never downgrade from Google to worse scrape."""
    best_phone: str | None = None
    best_score = 0

    if google_phone and not is_placeholder_phone(google_phone):
        google_score = phone_quality_score(google_phone, source="google")
        best_phone = normalize_phone(google_phone) or google_phone.strip()
        best_score = google_score

    for phone, source, labeled in candidates:
        if not phone or is_placeholder_phone(phone):
            continue
        score = phone_quality_score(phone, source=source, labeled=labeled)
        if score > best_score:
            normalized = normalize_phone(phone) or phone.strip()
            best_phone = normalized
            best_score = score

    return best_phone


def normalize_phone(raw: str | None) -> str | None:
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10:
        return raw.strip()
    return f"({digits[0:3]}) {digits[3:6]}-{digits[6:10]}"


def parse_city_state_zip(
    formatted_address: str, fallback_city: str, fallback_state: str
) -> tuple[str, str, str]:
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
    return [phone for phone, _pos in extract_phones_with_positions(text)]


def extract_phones_with_positions(text: str) -> list[tuple[str, int]]:
    """Normalized phones with the char offset of their first occurrence."""
    seen: set[str] = set()
    phones: list[tuple[str, int]] = []
    for match in _US_PHONE.finditer(text):
        normalized = normalize_phone(match.group())
        if normalized and normalized not in seen:
            seen.add(normalized)
            phones.append((normalized, match.start()))
    return phones


def extract_emails_with_positions(text: str) -> list[tuple[str, int]]:
    seen: set[str] = set()
    emails: list[tuple[str, int]] = []
    for match in _EMAIL.finditer(text):
        lower = match.group().lower()
        if lower not in seen and not lower.endswith((".png", ".jpg", ".gif", ".svg")):
            seen.add(lower)
            emails.append((lower, match.start()))
    return emails


def extract_emails(text: str) -> list[str]:
    seen: set[str] = set()
    emails: list[str] = []
    for match in _EMAIL.findall(text):
        lower = match.lower()
        if lower not in seen and not lower.endswith((".png", ".jpg", ".gif", ".svg")):
            seen.add(lower)
            emails.append(lower)
    return emails


def nfkc(value: str | None) -> str:
    """Unicode NFKC normalize person/company names before match and storage."""
    if not value:
        return ""
    return unicodedata.normalize("NFKC", value).strip()


def slugify(value: str) -> str:
    value = nfkc(value).lower()
    value = re.sub(r"[^\w\s-]", "", value)
    return re.sub(r"[-\s]+", "-", value).strip("-")


def normalize_entity_name(name: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", " ", nfkc(name).lower()).strip()
    return re.sub(r"\s+", " ", cleaned)

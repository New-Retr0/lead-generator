"""Shared URL safety helpers for exports, verification, and dashboard links."""

from __future__ import annotations

import ipaddress
import re
import socket
from urllib.parse import urlparse

_ALLOWED_SCHEMES = frozenset({"http", "https", "tel", "mailto"})

_INJECTION_RE = re.compile(
    r"(?i)(ignore\s+(all\s+)?(prior|previous|above)\s+instructions|"
    r"disregard|system\s*:|assistant\s*:|https?://|javascript:)"
)


def is_allowed_external_scheme(url: str) -> bool:
    parsed = urlparse(url.strip())
    return parsed.scheme.lower() in _ALLOWED_SCHEMES and bool(parsed.scheme)


def is_private_or_local_host(hostname: str) -> bool:
    host = hostname.strip().lower().rstrip(".")
    if not host or host in {"localhost", "127.0.0.1", "::1"}:
        return True
    if host.endswith(".localhost") or host.endswith(".local"):
        return True
    try:
        for info in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM):
            addr = info[4][0]
            ip = ipaddress.ip_address(addr)
            if (
                ip.is_private
                or ip.is_loopback
                or ip.is_link_local
                or ip.is_reserved
                or ip.is_multicast
            ):
                return True
    except OSError:
        return False
    return False


def is_safe_http_url(url: str) -> bool:
    if not url or not url.strip():
        return False
    normalized = url.strip()
    parsed = urlparse(normalized if "://" in normalized else f"https://{normalized}")
    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"}:
        return False
    host = parsed.hostname
    if not host:
        return False
    return not is_private_or_local_host(host)


def sanitize_task_param(value: str, *, max_len: int = 120) -> str:
    cleaned = " ".join(value.replace("\r", " ").replace("\n", " ").split())
    cleaned = _INJECTION_RE.sub("", cleaned)
    return cleaned[:max_len].strip()


def sanitize_csv_cell(value: str) -> str:
    if not value:
        return value
    if value[0] in ("=", "+", "-", "@"):
        return f"'{value}"
    return value

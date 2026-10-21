"""Validation of user-supplied media URLs before they reach yt-dlp."""

from __future__ import annotations

import ipaddress
import re
import socket
from urllib.parse import urlsplit, urlunsplit

MAX_URL_LENGTH = 2048
_CONTROL = re.compile(r"[\x00-\x20\x7f]")
_HOST_RE = re.compile(r"^[a-z0-9.-]+$|^\[[0-9a-f:.]+\]$")


class UrlError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _is_public_ip(ip: ipaddress._BaseAddress) -> bool:
    return not (
        ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast
        or ip.is_reserved or ip.is_unspecified
        or (isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None
            and not _is_public_ip(ip.ipv4_mapped))
    )


def validate_url(raw: str, allow_private: bool = False, resolve: bool = True) -> str:
    """Return a normalised http(s) URL or raise UrlError.

    Rejects non-http schemes, embedded credentials, control characters, and
    (unless allow_private) hosts that resolve to private/loopback addresses,
    so the downloader cannot be used to probe the local network.
    """
    if not isinstance(raw, str):
        raise UrlError("invalid_url", "That doesn't look like a link.")
    url = raw.strip()
    if not url:
        raise UrlError("invalid_url", "Paste a link first.")
    if len(url) > MAX_URL_LENGTH:
        raise UrlError("invalid_url", "That link is too long.")
    if _CONTROL.search(url):
        raise UrlError("invalid_url", "That link contains spaces or control characters.")
    if "://" not in url:
        url = "https://" + url
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError as exc:
        raise UrlError("invalid_url", "That doesn't look like a valid link.") from exc
    if parts.scheme.lower() not in {"http", "https"}:
        raise UrlError("invalid_url", "Only http and https links are supported.")
    if parts.username or parts.password:
        raise UrlError("invalid_url", "Links with embedded usernames or passwords aren't allowed.")
    host = (parts.hostname or "").lower().rstrip(".")
    if not host or not _HOST_RE.match(host if ":" not in host else f"[{host}]"):
        raise UrlError("invalid_url", "That link has no valid host name.")
    if not allow_private:
        _check_host(host, port or (443 if parts.scheme.lower() == "https" else 80), resolve)
    netloc = host if ":" not in host else f"[{host}]"
    if port:
        netloc += f":{port}"
    return urlunsplit((parts.scheme.lower(), netloc, parts.path or "/", parts.query, ""))


def _check_host(host: str, port: int, resolve: bool) -> None:
    blocked = UrlError("blocked_host", "Links to local or private network addresses aren't allowed.")
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
        raise blocked
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        ip = None
    if ip is not None:
        if not _is_public_ip(ip):
            raise blocked
        return
    if "." not in host:
        raise UrlError("invalid_url", "That link has no valid host name.")
    if not resolve:
        return
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise UrlError("dns_failed", "Couldn't find that website. Check the link.") from exc
    for info in infos:
        if not _is_public_ip(ipaddress.ip_address(info[4][0])):
            raise blocked

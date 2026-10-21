"""The backend's own copy of the allowlist (defense in depth behind here.now).

Sources, merged:
  1. A JSON file (default /app/config/allowed-emails.json), re-read when it changes.
  2. Optionally a URL (e.g. the raw GitHub file), refreshed every few minutes.
  3. DUBDECK_ALLOWED_EMAILS, a comma-separated list.

File format, identical to config/allowed-emails.json in the repo:
  { "emails": ["me@example.com"], "domains": ["example.com"] }
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import requests

log = logging.getLogger("dubdeck.allowlist")

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
DOMAIN_RE = re.compile(r"^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
URL_REFRESH_SECONDS = 300


@dataclass(frozen=True)
class Policy:
    emails: frozenset[str]
    domains: frozenset[str]

    def allows(self, email: str) -> bool:
        email = email.strip().lower()
        if not EMAIL_RE.match(email):
            return False
        if email in self.emails:
            return True
        return email.rsplit("@", 1)[1] in self.domains


def parse_policy(data: object) -> Policy:
    if not isinstance(data, dict):
        raise ValueError("allowlist must be a JSON object")
    emails = data.get("emails", [])
    domains = data.get("domains", [])
    if not isinstance(emails, list) or not isinstance(domains, list):
        raise ValueError("'emails' and 'domains' must be arrays")
    clean_emails = set()
    for e in emails:
        if not isinstance(e, str) or not EMAIL_RE.match(e.strip().lower()):
            raise ValueError(f"invalid email in allowlist: {e!r}")
        clean_emails.add(e.strip().lower())
    clean_domains = set()
    for d in domains:
        if not isinstance(d, str) or not DOMAIN_RE.match(d.strip().lower().lstrip("@")):
            raise ValueError(f"invalid domain in allowlist: {d!r}")
        clean_domains.add(d.strip().lower().lstrip("@"))
    return Policy(frozenset(clean_emails), frozenset(clean_domains))


class Allowlist:
    def __init__(self, path: Path, url: str = "", token: str = "", extra: tuple[str, ...] = ()):
        self._path = path
        self._url = url
        self._token = token
        self._extra = frozenset(extra)
        self._lock = threading.Lock()
        self._file_mtime: float | None = None
        self._file_policy = Policy(frozenset(), frozenset())
        self._url_policy = Policy(frozenset(), frozenset())
        self._url_checked = 0.0

    def _refresh_file(self) -> None:
        try:
            mtime = self._path.stat().st_mtime
        except FileNotFoundError:
            if self._file_mtime is not None:
                log.warning("allowlist file %s disappeared; keeping last good copy", self._path)
            return
        if mtime == self._file_mtime:
            return
        try:
            self._file_policy = parse_policy(json.loads(self._path.read_text("utf-8")))
            log.info("loaded allowlist from %s", self._path)
        except (ValueError, json.JSONDecodeError) as exc:
            log.error("ignoring invalid allowlist file %s: %s", self._path, exc)
        self._file_mtime = mtime

    def _refresh_url(self) -> None:
        if not self._url or time.time() - self._url_checked < URL_REFRESH_SECONDS:
            return
        self._url_checked = time.time()
        headers = {"Accept": "application/vnd.github.raw+json"}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        try:
            resp = requests.get(self._url, headers=headers, timeout=10)
            resp.raise_for_status()
            self._url_policy = parse_policy(resp.json())
            log.info("refreshed allowlist from URL")
        except Exception as exc:  # network or parse problem: keep last good copy
            log.error("allowlist URL refresh failed: %s", exc)

    def policy(self) -> Policy:
        with self._lock:
            self._refresh_file()
            self._refresh_url()
            return Policy(
                self._file_policy.emails | self._url_policy.emails | self._extra,
                self._file_policy.domains | self._url_policy.domains,
            )

    def allows(self, email: str) -> bool:
        return self.policy().allows(email)

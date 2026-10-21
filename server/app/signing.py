"""Short-lived HMAC-signed URLs for fetching one file straight from the backend.

Token = base64url(json payload) + "." + base64url(HMAC-SHA256(payload)).
The payload names exactly one file, a kind (media or thumb), a disposition,
and an absolute expiry. Nothing else is accepted on these routes.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


@dataclass(frozen=True)
class FileGrant:
    file_id: str
    kind: str  # "media" | "thumb"
    disposition: str  # "attachment" | "inline"
    expires_at: int


class SignatureError(Exception):
    pass


class Signer:
    def __init__(self, secret: str, ttl: int) -> None:
        self._key = hashlib.sha256(b"dubdeck-file-url:" + secret.encode()).digest()
        self.ttl = ttl

    def sign(self, file_id: str, kind: str = "media", disposition: str = "attachment",
             now: float | None = None) -> tuple[str, int]:
        if kind not in {"media", "thumb"} or disposition not in {"attachment", "inline"}:
            raise ValueError("bad grant")
        exp = int((now or time.time()) + self.ttl)
        payload = json.dumps(
            {"f": file_id, "k": kind, "d": disposition, "e": exp}, separators=(",", ":")
        ).encode()
        body = _b64(payload)
        sig = _b64(hmac.new(self._key, body.encode(), hashlib.sha256).digest())
        return f"{body}.{sig}", exp

    def verify(self, token: str, now: float | None = None) -> FileGrant:
        if len(token) > 512 or token.count(".") != 1:
            raise SignatureError("malformed")
        body, sig = token.split(".")
        expected = _b64(hmac.new(self._key, body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            raise SignatureError("bad signature")
        try:
            data = json.loads(_unb64(body))
            grant = FileGrant(str(data["f"]), str(data["k"]), str(data["d"]), int(data["e"]))
        except (ValueError, KeyError, TypeError) as exc:
            raise SignatureError("malformed") from exc
        if grant.expires_at < (now or time.time()):
            raise SignatureError("expired")
        return grant

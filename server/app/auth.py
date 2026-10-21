"""Two independent gates on every /api request.

1. X-DubDeck-Key: injected server-side by the here.now proxy route from an
   account variable. Proves the request came through the DubDeck Site's proxy.
2. A DubDeck session (opaque random token, stored hashed): obtained by
   exchanging a Google ID token whose verified email is on the backend's own
   allowlist. Sent by the browser as X-DubDeck-Session (or the dd_session
   query parameter if a proxy strips custom headers).

The allowlist is re-checked on every request, so removing an email locks
that person out immediately, even with a live session.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
import time
from dataclasses import dataclass

from fastapi import HTTPException, Request

from .allowlist import Allowlist
from .config import Config
from .db import Database

log = logging.getLogger("dubdeck.auth")

KEY_HEADER = "x-dubdeck-key"
SESSION_HEADER = "x-dubdeck-session"
SESSION_QUERY = "dd_session"


@dataclass(frozen=True)
class User:
    email: str
    name: str | None
    picture: str | None
    token_hash: str


def api_error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class Auth:
    def __init__(self, cfg: Config, db: Database, allowlist: Allowlist) -> None:
        self.cfg = cfg
        self.db = db
        self.allowlist = allowlist

    # -- gate 1 ---------------------------------------------------------
    def check_key(self, request: Request) -> None:
        supplied = request.headers.get(KEY_HEADER, "")
        if not supplied or not hmac.compare_digest(supplied.encode(), self.cfg.backend_key.encode()):
            raise api_error(401, "bad_key", "This request didn't come through the DubDeck site.")

    # -- gate 2 ---------------------------------------------------------
    @staticmethod
    def session_token(request: Request) -> str:
        return request.headers.get(SESSION_HEADER) or request.query_params.get(SESSION_QUERY) or ""

    def current_user(self, request: Request) -> User:
        token = self.session_token(request)
        if not token:
            raise api_error(401, "no_session", "Sign in to continue.")
        if len(token) > 200:
            raise api_error(401, "bad_session", "Your session is invalid. Sign in again.")
        row = self.db.one("SELECT * FROM sessions WHERE token_hash = ?", (_hash(token),))
        now = time.time()
        if not row or row["expires_at"] < now:
            if row:
                self.db.execute("DELETE FROM sessions WHERE token_hash = ?", (row["token_hash"],))
            raise api_error(401, "bad_session", "Your session expired. Sign in again.")
        if not self.allowlist.allows(row["email"]):
            self.db.execute("DELETE FROM sessions WHERE email = ?", (row["email"],))
            raise api_error(403, "not_allowed", "This account is no longer allowed to use DubDeck.")
        if now - row["last_seen"] > 300:
            self.db.execute(
                "UPDATE sessions SET last_seen = ? WHERE token_hash = ?", (now, row["token_hash"])
            )
        return User(row["email"], row["name"], row["picture"], row["token_hash"])

    def create_session(self, email: str, name: str | None, picture: str | None,
                       user_agent: str | None) -> tuple[str, float]:
        token = secrets.token_urlsafe(32)
        now = time.time()
        expires = now + self.cfg.session_days * 86400
        self.db.execute(
            "INSERT INTO sessions(token_hash, email, name, picture, created_at, last_seen, "
            "expires_at, user_agent) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
            (_hash(token), email, name, picture, now, now, expires, (user_agent or "")[:300]),
        )
        self.db.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
        return token, expires

    def end_session(self, user: User, everywhere: bool = False) -> None:
        if everywhere:
            self.db.execute("DELETE FROM sessions WHERE email = ?", (user.email,))
        else:
            self.db.execute("DELETE FROM sessions WHERE token_hash = ?", (user.token_hash,))

    # -- Google ---------------------------------------------------------
    def verify_google(self, credential: str) -> tuple[str, str | None, str | None]:
        """Verify a Google Identity Services ID token; return (email, name, picture)."""
        from google.auth.transport import requests as g_requests
        from google.oauth2 import id_token

        if not self.cfg.google_client_id:
            raise api_error(503, "google_not_configured", "Google sign-in isn't configured on the server.")
        if not credential or len(credential) > 8192:
            raise api_error(400, "bad_credential", "Google sign-in failed. Try again.")
        try:
            claims = id_token.verify_oauth2_token(
                credential, g_requests.Request(), self.cfg.google_client_id, clock_skew_in_seconds=10
            )
        except ValueError as exc:
            log.info("rejected Google token: %s", exc)
            raise api_error(401, "bad_credential", "Google sign-in failed. Try again.") from exc
        if claims.get("iss") not in {"accounts.google.com", "https://accounts.google.com"}:
            raise api_error(401, "bad_credential", "Google sign-in failed. Try again.")
        email = str(claims.get("email", "")).lower()
        if not email or claims.get("email_verified") is not True:
            raise api_error(403, "unverified_email", "Your Google email address isn't verified.")
        return email, claims.get("name"), claims.get("picture")

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

import base64
import json
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
    token_hash: str  # the session's token id (jti)
    issued_at: float = 0.0


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

    # Sessions are self-contained signed tokens, so they survive a server whose
    # disk is wiped on restart (Render's free plan). Format:
    #   s1.<base64url JSON {e,n,p,i,x,j}>.<base64url HMAC-SHA256>
    # Revocation (sign out) is recorded in the database by token id / epoch.
    def _session_key(self) -> bytes:
        return hashlib.sha256(b"dubdeck-session:" + self.cfg.signing_secret.encode()).digest()

    def _encode(self, claims: dict) -> str:
        body = base64.urlsafe_b64encode(json.dumps(claims, separators=(",", ":")).encode()).rstrip(b"=").decode()
        sig = base64.urlsafe_b64encode(
            hmac.new(self._session_key(), body.encode(), hashlib.sha256).digest()).rstrip(b"=").decode()
        return f"s1.{body}.{sig}"

    def _decode(self, token: str) -> dict | None:
        parts = token.split(".")
        if len(parts) != 3 or parts[0] != "s1":
            return None
        expected = base64.urlsafe_b64encode(
            hmac.new(self._session_key(), parts[1].encode(), hashlib.sha256).digest()).rstrip(b"=").decode()
        if not hmac.compare_digest(expected, parts[2]):
            return None
        try:
            return json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
        except ValueError:
            return None

    def current_user(self, request: Request) -> User:
        token = self.session_token(request)
        if not token:
            raise api_error(401, "no_session", "Sign in to continue.")
        claims = self._decode(token) if len(token) < 4000 else None
        now = time.time()
        if not claims or float(claims.get("x", 0)) < now:
            raise api_error(401, "bad_session", "Your session expired. Sign in again.")
        email = str(claims.get("e", ""))
        if self.db.one("SELECT 1 FROM revoked_sessions WHERE jti = ?", (claims.get("j"),)):
            raise api_error(401, "bad_session", "You signed out on this device. Sign in again.")
        epoch = self.db.get_json(f"session_epoch:{email}")
        if epoch and float(claims.get("i", 0)) < epoch[0]:
            raise api_error(401, "bad_session", "You were signed out everywhere. Sign in again.")
        if not self.allowlist.allows(email):
            raise api_error(403, "not_allowed", "This account is no longer allowed to use DubDeck.")
        return User(email, claims.get("n"), claims.get("p"), str(claims.get("j")), float(claims.get("i", 0)))

    def create_session(self, email: str, name: str | None, picture: str | None,
                       user_agent: str | None = None) -> tuple[str, float]:
        now = time.time()
        expires = now + self.cfg.session_days * 86400
        token = self._encode({"e": email, "n": name, "p": picture, "i": now, "x": expires,
                              "j": secrets.token_urlsafe(12)})
        return token, expires

    def renew(self, user: User) -> tuple[str, float] | None:
        """Sliding expiry: a fresh token once the current one is a day old."""
        if time.time() - user.issued_at < 86400:
            return None
        self.end_session(user)
        return self.create_session(user.email, user.name, user.picture)

    def end_session(self, user: User, everywhere: bool = False) -> None:
        now = time.time()
        if everywhere:
            self.db.set_json(f"session_epoch:{user.email}", now, now)
        else:
            self.db.execute(
                "INSERT OR IGNORE INTO revoked_sessions(jti, expires_at) VALUES(?, ?)",
                (user.token_hash, now + self.cfg.session_days * 86400),
            )
        self.db.execute("DELETE FROM revoked_sessions WHERE expires_at < ?", (now,))

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

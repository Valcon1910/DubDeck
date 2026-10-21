"""Sign-in by emailed 6-digit code (used when Google Cloud isn't available)."""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
import smtplib
import ssl
import time
from email.message import EmailMessage

from .config import Config
from .db import Database

log = logging.getLogger("dubdeck.mailcode")

CODE_TTL = 10 * 60
MAX_ATTEMPTS = 5
RESEND_AFTER = 30


class CodeError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class MailCodes:
    def __init__(self, cfg: Config, db: Database) -> None:
        self.cfg = cfg
        self.db = db
        self._pepper = hashlib.sha256(b"dubdeck-login-code:" + cfg.signing_secret.encode()).digest()

    @property
    def enabled(self) -> bool:
        return bool(self.cfg.smtp_host)

    def _hash(self, email: str, code: str) -> str:
        return hmac.new(self._pepper, f"{email}:{code}".encode(), hashlib.sha256).hexdigest()

    def issue(self, email: str) -> str | None:
        """Store a fresh code for email; returns it, or None if one was sent very recently."""
        now = time.time()
        row = self.db.one("SELECT created_at FROM login_codes WHERE email = ?", (email,))
        if row and now - row["created_at"] < RESEND_AFTER:
            return None
        code = f"{secrets.randbelow(1_000_000):06d}"
        self.db.execute(
            "INSERT INTO login_codes(email, code_hash, expires_at, attempts, created_at) VALUES(?, ?, ?, 0, ?) "
            "ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, "
            "expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at",
            (email, self._hash(email, code), now + CODE_TTL, now),
        )
        return code

    def verify(self, email: str, code: str) -> None:
        row = self.db.one("SELECT * FROM login_codes WHERE email = ?", (email,))
        if not row or row["expires_at"] < time.time():
            raise CodeError("code_expired", "That code has expired. Request a new one.")
        if row["attempts"] >= MAX_ATTEMPTS:
            raise CodeError("too_many_attempts", "Too many wrong codes. Request a new one.")
        if not hmac.compare_digest(row["code_hash"], self._hash(email, code)):
            self.db.execute("UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?", (email,))
            raise CodeError("bad_code", "That code isn't right. Check the email and try again.")
        self.db.execute("DELETE FROM login_codes WHERE email = ?", (email,))

    def send(self, email: str, code: str) -> None:
        msg = EmailMessage()
        msg["Subject"] = f"{code} is your DubDeck sign-in code"
        msg["From"] = self.cfg.smtp_from
        msg["To"] = email
        msg.set_content(
            f"Your DubDeck sign-in code is {code}\n\n"
            "It expires in 10 minutes. If you didn't try to sign in, ignore this email.\n"
        )
        c = self.cfg
        ctx = ssl.create_default_context()
        if c.smtp_security == "ssl":
            server: smtplib.SMTP = smtplib.SMTP_SSL(c.smtp_host, c.smtp_port, timeout=20, context=ctx)
        else:
            server = smtplib.SMTP(c.smtp_host, c.smtp_port, timeout=20)
        with server:
            if c.smtp_security == "starttls":
                server.starttls(context=ctx)
            if c.smtp_user:
                server.login(c.smtp_user, c.smtp_password)
            server.send_message(msg)
        log.info("sent sign-in code to %s", email)

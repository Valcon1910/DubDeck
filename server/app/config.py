"""Runtime configuration, read once from environment variables.

Every setting has a DUBDECK_ prefix so the same image runs unchanged on a
home PC (Docker + Cloudflare Tunnel), Render, or Fly.io.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if not raw:
        return default
    return int(raw)


@dataclass(frozen=True)
class Config:
    backend_key: str
    signing_secret: str
    public_url: str
    google_client_id: str
    data_dir: Path
    allowlist_path: Path
    allowlist_url: str
    allowlist_token: str
    extra_allowed_emails: tuple[str, ...]
    session_days: int
    trust_cf_headers: bool
    dev_login: bool
    allow_private_urls: bool
    cookies_file: str
    owner_passcode: str = ""
    ephemeral: bool = False
    owner_email: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_security: str = "starttls"  # starttls | ssl | none
    signed_url_ttl: int = 15 * 60
    ytdlp_target: Path = field(default_factory=lambda: Path("/data/ytdlp"))

    @property
    def db_path(self) -> Path:
        return self.data_dir / "dubdeck.db"

    @property
    def media_dir(self) -> Path:
        return self.data_dir / "media"

    @property
    def thumbs_dir(self) -> Path:
        return self.data_dir / "thumbs"

    @property
    def work_dir(self) -> Path:
        return self.data_dir / "work"


class ConfigError(RuntimeError):
    pass


def load_config() -> Config:
    data_dir = Path(os.environ.get("DUBDECK_DATA_DIR", "/data")).resolve()
    cfg = Config(
        backend_key=os.environ.get("DUBDECK_BACKEND_KEY", ""),
        signing_secret=os.environ.get("DUBDECK_SIGNING_SECRET", ""),
        # On Render, RENDER_EXTERNAL_URL is set automatically (https://<service>.onrender.com).
        public_url=(os.environ.get("DUBDECK_PUBLIC_URL") or os.environ.get("RENDER_EXTERNAL_URL")
                    or "http://localhost:8000").rstrip("/"),
        google_client_id=os.environ.get("DUBDECK_GOOGLE_CLIENT_ID", ""),
        data_dir=data_dir,
        allowlist_path=Path(
            os.environ.get("DUBDECK_ALLOWLIST_PATH", "/app/config/allowed-emails.json")
        ),
        allowlist_url=os.environ.get("DUBDECK_ALLOWLIST_URL", ""),
        allowlist_token=os.environ.get("DUBDECK_ALLOWLIST_TOKEN", ""),
        extra_allowed_emails=tuple(
            e.strip().lower()
            for e in os.environ.get("DUBDECK_ALLOWED_EMAILS", "").split(",")
            if e.strip()
        ),
        session_days=_int("DUBDECK_SESSION_DAYS", 30),
        trust_cf_headers=_bool("DUBDECK_TRUST_CF_HEADERS", True),
        dev_login=_bool("DUBDECK_DEV_LOGIN", False),
        allow_private_urls=_bool("DUBDECK_ALLOW_PRIVATE_URLS", False),
        cookies_file=os.environ.get("DUBDECK_COOKIES_FILE", ""),
        owner_passcode=os.environ.get("DUBDECK_OWNER_PASSCODE", ""),
        # Disk is wiped on restart (Render free): the UI saves files to the device right away.
        ephemeral=_bool("DUBDECK_EPHEMERAL", False),
        owner_email=os.environ.get("DUBDECK_OWNER_EMAIL", "").strip().lower(),
        smtp_host=os.environ.get("DUBDECK_SMTP_HOST", ""),
        smtp_port=_int("DUBDECK_SMTP_PORT", 587),
        smtp_user=os.environ.get("DUBDECK_SMTP_USER", ""),
        smtp_password=os.environ.get("DUBDECK_SMTP_PASSWORD", ""),
        smtp_from=os.environ.get("DUBDECK_SMTP_FROM", "") or os.environ.get("DUBDECK_SMTP_USER", ""),
        smtp_security=os.environ.get("DUBDECK_SMTP_SECURITY", "starttls").lower(),
        signed_url_ttl=_int("DUBDECK_SIGNED_URL_TTL", 15 * 60),
        ytdlp_target=Path(os.environ.get("DUBDECK_YTDLP_TARGET", str(data_dir / "ytdlp"))),
    )
    validate(cfg)
    return cfg


def validate(cfg: Config) -> None:
    if len(cfg.backend_key) < 32:
        raise ConfigError("DUBDECK_BACKEND_KEY must be set (at least 32 characters).")
    if len(cfg.signing_secret) < 32:
        raise ConfigError("DUBDECK_SIGNING_SECRET must be set (at least 32 characters).")
    if cfg.signing_secret == cfg.backend_key:
        raise ConfigError("DUBDECK_SIGNING_SECRET must differ from DUBDECK_BACKEND_KEY.")
    if not (cfg.owner_passcode or cfg.smtp_host or cfg.google_client_id or cfg.dev_login):
        raise ConfigError(
            "Configure a sign-in method: DUBDECK_OWNER_PASSCODE, DUBDECK_SMTP_* (emailed codes) "
            "or DUBDECK_GOOGLE_CLIENT_ID (or DUBDECK_DEV_LOGIN=1 for local testing)."
        )
    if cfg.owner_passcode and len(cfg.owner_passcode) < 10:
        raise ConfigError("DUBDECK_OWNER_PASSCODE must be at least 10 characters.")
    if cfg.smtp_host and (not cfg.smtp_from or cfg.smtp_security not in {"starttls", "ssl", "none"}):
        raise ConfigError("Set DUBDECK_SMTP_FROM (or DUBDECK_SMTP_USER) and a valid DUBDECK_SMTP_SECURITY.")
    if not 60 <= cfg.signed_url_ttl <= 15 * 60:
        raise ConfigError("DUBDECK_SIGNED_URL_TTL must be between 60 and 900 seconds.")

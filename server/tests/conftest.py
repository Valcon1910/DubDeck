import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Config  # noqa: E402

KEY = "k" * 40
OWNER = "owner@example.com"


def make_config(tmp: Path | None = None, **overrides) -> Config:
    import tempfile

    tmp = tmp or Path(tempfile.mkdtemp())
    allow = tmp / "allowed-emails.json"
    if not allow.exists():
        allow.write_text(json.dumps({"emails": [OWNER], "domains": []}))
    values = dict(
        backend_key=KEY, signing_secret="s" * 40, public_url="https://api.example.com",
        google_client_id="client.apps.googleusercontent.com", data_dir=tmp / "data",
        allowlist_path=allow, allowlist_url="", allowlist_token="", extra_allowed_emails=(),
        session_days=30, trust_cf_headers=True, dev_login=True, allow_private_urls=False,
        cookies_file="", signed_url_ttl=900, ytdlp_target=tmp / "ytdlp",
    )
    values.update(overrides)
    return Config(**values)


@pytest.fixture
def cfg(tmp_path):
    return make_config(tmp_path)


@pytest.fixture
def client(cfg):
    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app(cfg)) as c:
        yield c


@pytest.fixture
def session(client):
    r = client.post("/api/auth/dev", json={"email": OWNER}, headers={"X-DubDeck-Key": KEY})
    assert r.status_code == 200, r.text
    return {"X-DubDeck-Key": KEY, "X-DubDeck-Session": r.json()["token"]}

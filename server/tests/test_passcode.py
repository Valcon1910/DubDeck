import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import KEY, OWNER, make_config

H = {"X-DubDeck-Key": KEY}
PASS = "correct horse battery"


@pytest.fixture
def pc(tmp_path):
    cfg = make_config(tmp_path, owner_passcode=PASS, google_client_id="", dev_login=False)
    with TestClient(create_app(cfg)) as c:
        yield c, cfg


def test_passcode_signs_in_as_owner(pc):
    c, _ = pc
    assert c.get("/api/auth/config", headers=H).json()["passcodeLogin"] is True
    r = c.post("/api/auth/passcode", json={"passcode": PASS}, headers=H)
    assert r.status_code == 200 and r.json()["user"]["email"] == OWNER
    me = c.get("/api/auth/me", headers={**H, "X-DubDeck-Session": r.json()["token"]})
    assert me.json()["email"] == OWNER


def test_wrong_passcode_and_lockout(pc):
    c, _ = pc
    for _ in range(10):
        assert c.post("/api/auth/passcode", json={"passcode": "nope"}, headers=H).status_code == 401
    r = c.post("/api/auth/passcode", json={"passcode": PASS}, headers=H)
    assert r.status_code == 429


def test_passcode_needs_the_proxy_key(pc):
    c, _ = pc
    assert c.post("/api/auth/passcode", json={"passcode": PASS}).status_code == 401


def test_short_passcode_rejected(tmp_path):
    from app.config import ConfigError, validate
    with pytest.raises(ConfigError):
        validate(make_config(tmp_path, owner_passcode="short", google_client_id="", dev_login=False))

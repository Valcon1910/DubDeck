import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import KEY, OWNER, make_config

H = {"X-DubDeck-Key": KEY}


@pytest.fixture
def mail_client(tmp_path):
    cfg = make_config(tmp_path, smtp_host="smtp.example.com", smtp_from="dubdeck@example.com",
                      google_client_id="", dev_login=False)
    app = create_app(cfg)
    sent = []
    app.state.services.mailcodes.send = lambda email, code: sent.append((email, code))
    with TestClient(app) as c:
        yield c, sent


def test_config_advertises_email_login(mail_client):
    c, _ = mail_client
    assert c.get("/api/auth/config", headers=H).json() == {
        "googleClientId": None, "emailLogin": True, "passcodeLogin": False, "ephemeral": False, "devLogin": False}


def test_code_signs_in(mail_client):
    c, sent = mail_client
    assert c.post("/api/auth/email/start", json={"email": OWNER.upper()}, headers=H).json() == {"ok": True}
    email, code = sent[-1]
    assert email == OWNER and len(code) == 6
    r = c.post("/api/auth/email/verify", json={"email": OWNER, "code": code}, headers=H)
    assert r.status_code == 200
    me = c.get("/api/auth/me", headers={**H, "X-DubDeck-Session": r.json()["token"]})
    assert me.json()["email"] == OWNER
    # Codes are single-use.
    r = c.post("/api/auth/email/verify", json={"email": OWNER, "code": code}, headers=H)
    assert r.status_code == 401


def test_unlisted_email_gets_no_code_and_same_answer(mail_client):
    c, sent = mail_client
    r = c.post("/api/auth/email/start", json={"email": "stranger@example.com"}, headers=H)
    assert r.json() == {"ok": True} and sent == []


def test_wrong_codes_lock_out(mail_client):
    c, sent = mail_client
    c.post("/api/auth/email/start", json={"email": OWNER}, headers=H)
    code = sent[-1][1]
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(5):
        assert c.post("/api/auth/email/verify", json={"email": OWNER, "code": wrong}, headers=H).status_code == 401
    r = c.post("/api/auth/email/verify", json={"email": OWNER, "code": code}, headers=H)
    assert r.json()["error"]["code"] == "too_many_attempts"


def test_resend_is_throttled(mail_client):
    c, sent = mail_client
    c.post("/api/auth/email/start", json={"email": OWNER}, headers=H)
    c.post("/api/auth/email/start", json={"email": OWNER}, headers=H)
    assert len(sent) == 1

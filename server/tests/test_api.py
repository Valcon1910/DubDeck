import json

from tests.conftest import KEY, OWNER


def test_health_is_open(client):
    assert client.get("/healthz").json() == {"ok": True}


def test_api_requires_key(client):
    r = client.get("/api/auth/config")
    assert r.status_code == 401 and r.json()["error"]["code"] == "bad_key"
    r = client.get("/api/auth/config", headers={"X-DubDeck-Key": "wrong" * 10})
    assert r.status_code == 401


def test_key_alone_is_not_enough(client):
    r = client.get("/api/library", headers={"X-DubDeck-Key": KEY})
    assert r.status_code == 401 and r.json()["error"]["code"] == "no_session"


def test_session_via_header_and_query(client, session):
    assert client.get("/api/auth/me", headers=session).json()["email"] == OWNER
    r = client.get(f"/api/auth/me?dd_session={session['X-DubDeck-Session']}",
                   headers={"X-DubDeck-Key": KEY})
    assert r.status_code == 200


def test_dev_login_refuses_unlisted_email(client):
    r = client.post("/api/auth/dev", json={"email": "stranger@example.com"}, headers={"X-DubDeck-Key": KEY})
    assert r.status_code == 403 and r.json()["error"]["code"] == "not_allowed"


def test_removing_email_revokes_live_session(client, session, cfg):
    cfg.allowlist_path.write_text(json.dumps({"emails": ["other@example.com"], "domains": []}))
    import os
    import time
    st = cfg.allowlist_path.stat()
    os.utime(cfg.allowlist_path, (st.st_atime, st.st_mtime + 5))  # force a reload
    r = client.get("/api/auth/me", headers=session)
    assert r.status_code == 403 and r.json()["error"]["code"] == "not_allowed"


def test_logout(client, session):
    assert client.post("/api/auth/logout", json={}, headers=session).status_code == 200
    assert client.get("/api/auth/me", headers=session).status_code == 401


def test_google_token_rejected(client):
    r = client.post("/api/auth/google", json={"credential": "not-a-real-google-token"},
                    headers={"X-DubDeck-Key": KEY})
    assert r.status_code == 401


def test_preview_blocks_private_hosts(client, session):
    r = client.post("/api/preview", json={"url": "http://127.0.0.1/admin"}, headers=session)
    assert r.status_code == 400 and r.json()["error"]["code"] == "blocked_host"
    r = client.post("/api/preview", json={"url": "file:///etc/passwd"}, headers=session)
    assert r.status_code == 400


def test_jobs_validate_options(client, session):
    r = client.post("/api/jobs", json={"items": [{"url": "https://example.com/v"}],
                                       "options": {"kind": "video", "quality": "999"}}, headers=session)
    assert r.status_code == 422
    r = client.post("/api/jobs", json={"items": [{"url": "https://example.com/v"}],
                                       "options": {"kind": "video", "evil": True}}, headers=session)
    assert r.status_code == 422


def test_settings_roundtrip_and_conflict(client, session):
    got = client.get("/api/settings", headers=session).json()
    s = got["settings"]
    s["appearance"]["theme"] = "dark"
    r = client.put("/api/settings", json={"settings": s, "baseUpdatedAt": got["updatedAt"]}, headers=session)
    assert r.status_code == 200
    first = r.json()["updatedAt"]
    assert client.get("/api/settings", headers=session).json()["settings"]["appearance"]["theme"] == "dark"
    # A device holding a stale copy gets 409 with the current settings.
    r = client.put("/api/settings", json={"settings": s, "baseUpdatedAt": first - 10}, headers=session)
    assert r.status_code == 409 and r.json()["settings"]["appearance"]["theme"] == "dark"
    s["appearance"]["accent"] = "red"
    assert client.put("/api/settings", json={"settings": s}, headers=session).status_code == 422


def _add_file(client, cfg, name="clip", kind="video", ext="mp4", size=10, age=0):
    import time
    lib = client.app.state.services.library
    src = cfg.data_dir / f"src-{name}.{ext}"
    src.write_bytes(b"x" * size)
    row = lib.add(job_id="j", src=src, thumb=None, name=name, kind=kind, quality="720p", meta={})
    if age:
        client.app.state.services.db.execute("UPDATE files SET created_at = ? WHERE id = ?",
                                             (time.time() - age, row["id"]))
    return row["id"]


def test_signed_download_flow(client, session, cfg):
    fid = _add_file(client, cfg, "My Clip")
    r = client.post(f"/api/library/{fid}/link", json={"disposition": "attachment"}, headers=session)
    url = r.json()["url"]
    assert url.startswith("https://api.example.com/f/")
    path = url.removeprefix("https://api.example.com")
    r = client.get(path)  # no key, no session: the signature is the only credential
    assert r.status_code == 200 and r.content == b"x" * 10
    assert "attachment" in r.headers["content-disposition"]
    assert client.get(path + "x").status_code == 403
    assert client.get("/f/garbage").status_code == 403
    r = client.get(path, headers={"Range": "bytes=2-4"})
    assert r.status_code == 206 and r.content == b"xxx"


def test_library_rename_delete_stats(client, session, cfg):
    a = _add_file(client, cfg, "a", size=100)
    b = _add_file(client, cfg, "b", kind="audio", ext="mp3", size=50)
    stats = client.get("/api/library/stats", headers=session).json()
    assert stats["usedBytes"] == 150 and stats["byKind"]["audio"]["bytes"] == 50
    assert stats["largest"][0]["id"] == a
    r = client.patch(f"/api/library/{a}", json={"name": "../../etc/passwd"}, headers=session)
    assert r.json()["file"]["name"] == "etc passwd"
    assert client.post("/api/library/delete", json={"ids": [a, b]}, headers=session).json()["deleted"] == 2
    assert client.get("/api/library", headers=session).json()["files"] == []


def test_auto_cleanup(client, session, cfg):
    old = _add_file(client, cfg, "old", size=10, age=40 * 86400)
    new = _add_file(client, cfg, "new", size=10)
    s = client.get("/api/settings", headers=session).json()["settings"]
    s["storage"].update(autoCleanup=True, maxAgeDays=30)
    client.put("/api/settings", json={"settings": s}, headers=session)
    assert client.post("/api/library/cleanup", headers=session).json()["deleted"] == 1
    ids = [f["id"] for f in client.get("/api/library", headers=session).json()["files"]]
    assert ids == [new] and old not in ids


def test_rate_limit(client):
    codes = [client.get("/api/auth/config").status_code for _ in range(70)]
    assert 429 in codes

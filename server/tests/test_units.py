import json
import time

import pytest

from app.allowlist import Policy, parse_policy
from app.errors import friendly
from app.filenames import render, sanitize
from app.models import DownloadOptions, Settings, parse_timestamp
from app.signing import SignatureError, Signer
from app.urls import UrlError, validate_url
from app.ytdlp import download_args, summarize, video_sort


# -- urls -------------------------------------------------------------------

@pytest.mark.parametrize("raw", [
    "file:///etc/passwd", "ftp://example.com/x", "javascript:alert(1)",
    "http://user:pass@example.com/", "https://exa mple.com/", "http://localhost/x",
    "http://127.0.0.1/x", "http://10.0.0.5/", "http://[::1]/", "http://169.254.169.254/latest",
    "http://192.168.1.10/a", "http://printer.local/", "http://intranet/", "",
    "https://example.com/\x00",
])
def test_rejects_bad_urls(raw):
    with pytest.raises(UrlError):
        validate_url(raw, resolve=False)


def test_accepts_and_normalises_urls():
    assert validate_url("youtube.com/watch?v=abc", resolve=False) == "https://youtube.com/watch?v=abc"
    assert validate_url("HTTPS://Example.COM/a#frag", resolve=False) == "https://example.com/a"
    assert validate_url("http://127.0.0.1:8765/x.mp4", allow_private=True) == "http://127.0.0.1:8765/x.mp4"


def test_option_like_url_cannot_become_a_flag():
    args = download_args(_cfg(), DownloadOptions(), "https://example.com/--exec=rm", _tmp())
    assert args[-2:] == ["--", "https://example.com/--exec=rm"]
    assert "--ignore-config" in args


# -- signing ------------------------------------------------------------------

def test_signed_url_roundtrip_and_tamper():
    s = Signer("x" * 40, 900)
    token, exp = s.sign("abc", "media", "attachment")
    g = s.verify(token)
    assert (g.file_id, g.kind, g.disposition) == ("abc", "media", "attachment")
    assert exp - time.time() <= 900
    body, sig = token.split(".")
    with pytest.raises(SignatureError):
        s.verify(body + "." + sig[:-2] + "AA")
    with pytest.raises(SignatureError):
        Signer("y" * 40, 900).verify(token)


def test_signed_url_expires():
    s = Signer("x" * 40, 900)
    token, _ = s.sign("abc", now=time.time() - 1000)
    with pytest.raises(SignatureError):
        s.verify(token)


# -- filenames ----------------------------------------------------------------

def test_template_rendering():
    v = {"title": "Song: Live/Remix?", "channel": "Band", "quality": "1080p"}
    assert render("{title} - {channel}", v) == "Song Live Remix - Band"
    assert render("{title} - {channel}", {"title": "Song"}) == "Song"
    assert render("{title} ({date})", {"title": "Song"}) == "Song"
    assert render("{title} - {channel} [{quality}]", {"title": "T", "quality": "720p"}) == "T [720p]"
    assert render("{unknown} {title}", {"title": "T"}) == "{unknown} T"
    assert render("{channel}", {"title": "Fallback"}) == "Fallback"


def test_sanitize():
    assert sanitize("CON") == "_CON"
    assert sanitize("  ..a<b>c..  ") == "a b c"
    assert len(sanitize("x" * 500)) <= 180
    assert sanitize("") == "download"


# -- errors -------------------------------------------------------------------

@pytest.mark.parametrize("stderr, code", [
    ("ERROR: Unsupported URL: https://example.com/", "unsupported_site"),
    ("ERROR: [youtube] abc: Private video. Sign in if you've been granted access", "private"),
    ("ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate", "age_restricted"),
    ("ERROR: [youtube] abc: The uploader has not made this video available in your country", "region_blocked"),
    ("ERROR: [youtube] abc: Sign in to confirm you’re not a bot.", "bot_check"),
    ("ERROR: something odd", "unknown"),
])
def test_friendly_errors(stderr, code):
    assert friendly("WARNING: noise\n" + stderr).code == code


# -- models ------------------------------------------------------------------

def test_timestamps():
    assert parse_timestamp("90") == 90
    assert parse_timestamp("1:30") == 90
    assert parse_timestamp("01:02:03.5") == 3723.5
    with pytest.raises(ValueError):
        parse_timestamp("1:75")


def test_trim_order_validated():
    with pytest.raises(ValueError):
        DownloadOptions(trimStart="0:30", trimEnd="0:10")


def test_bad_subtitle_language():
    with pytest.raises(ValueError):
        DownloadOptions(subtitles="en; rm -rf /")


def test_settings_defaults_have_presets():
    s = Settings()
    assert s.presets and s.defaults.presetId in {p.id for p in s.presets}


# -- format selection ---------------------------------------------------------

def test_video_sort():
    assert video_sort(DownloadOptions(quality="1080")) == "res:1080,vcodec:h264,acodec:aac,ext:mp4:m4a"
    assert video_sort(DownloadOptions(container="webm")).startswith("res,vcodec:vp9")


def test_audio_args():
    args = download_args(_cfg(), DownloadOptions(kind="audio", audioFormat="mp3", audioBitrate=192),
                         "https://example.com/v", _tmp())
    assert ["--audio-format", "mp3"] == args[args.index("--audio-format"):][:2]
    assert "192K" in args


def test_trim_args():
    args = download_args(_cfg(), DownloadOptions(trimStart="1:00", trimEnd="1:30"),
                         "https://example.com/v", _tmp())
    assert args[args.index("--download-sections") + 1] == "*60.000-90.000"


# -- allowlist ----------------------------------------------------------------

def test_allowlist_policy():
    p = parse_policy({"emails": ["Me@Example.com"], "domains": ["corp.org"]})
    assert p.allows("me@example.com")
    assert p.allows("anyone@corp.org")
    assert not p.allows("x@evil.org")
    assert not p.allows("me@example.com.evil.org")
    with pytest.raises(ValueError):
        parse_policy({"emails": ["not-an-email"]})
    assert not Policy(frozenset(), frozenset()).allows("me@example.com")


def test_summarize_playlist():
    info = {"_type": "playlist", "title": "PL", "entries": [
        {"id": "a", "title": "A", "url": "https://x.com/a"}, {"id": "b", "url": "b"}]}
    out = summarize(info)
    assert out["type"] == "playlist" and [e["id"] for e in out["entries"]] == ["a"]


# -- helpers -------------------------------------------------------------------

def _cfg():
    from tests.conftest import make_config
    return make_config()


def _tmp():
    import pathlib
    import tempfile
    return pathlib.Path(tempfile.mkdtemp())

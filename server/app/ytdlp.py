"""Everything that talks to yt-dlp.

yt-dlp always runs as a child process with an argument list (never a shell),
with --ignore-config so no config file can add options, and with "--" before
the URL so a URL can never be parsed as an option.
"""

from __future__ import annotations

import asyncio
import json
import os
import signal
import sys
from pathlib import Path
from typing import Any

from .config import Config
from .errors import FriendlyError, friendly
from .models import DownloadOptions

PREVIEW_TIMEOUT = 60
MAX_PLAYLIST_ENTRIES = 500

PROGRESS_PREFIX = "DDPROG "
PRE_PREFIX = "DDPRE "
POST_PREFIX = "DDPOST"
DONE_PREFIX = "DDDONE "

PROGRESS_TEMPLATE = (
    "download:" + PROGRESS_PREFIX
    + "%(progress.{status,downloaded_bytes,total_bytes,total_bytes_estimate,speed,eta,"
      "fragment_index,fragment_count})j %(info.format_id)j"
)
PRE_TEMPLATE = (
    "before_dl:" + PRE_PREFIX
    + "%(.{format_id,filesize,filesize_approx,requested_formats})j"
)
DONE_TEMPLATE = (
    "after_move:" + DONE_PREFIX
    + "%(.{filepath,id,title,uploader,channel,creator,artist,album,playlist_title,duration,"
      "ext,width,height,vcodec,acodec,abr,upload_date,extractor_key,webpage_url})j"
)


def child_env(cfg: Config) -> dict[str, str]:
    """Environment for yt-dlp: a self-updated copy in ytdlp_target wins over the bundled one."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("DUBDECK_")}
    if (cfg.ytdlp_target / "yt_dlp").is_dir():
        env["PYTHONPATH"] = str(cfg.ytdlp_target) + os.pathsep + env.get("PYTHONPATH", "")
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    return env


def base_args(cfg: Config) -> list[str]:
    args = [
        sys.executable, "-m", "yt_dlp",
        "--ignore-config", "--no-exec", "--no-batch-file",
        "--socket-timeout", "30", "--retries", "10", "--fragment-retries", "10",
        "--no-colors",
    ]
    if cfg.cookies_file and Path(cfg.cookies_file).is_file():
        args += ["--cookies", cfg.cookies_file]
    return args


# -- format selection -----------------------------------------------------

def video_sort(opts: DownloadOptions) -> str:
    res = "res" if opts.quality == "best" else f"res:{opts.quality}"
    if opts.container == "webm":
        return f"{res},vcodec:vp9,acodec:opus,ext:webm:webm"
    if opts.mp4Compat == "strict":
        return f"{res},vcodec:h264,acodec:aac,ext:mp4:m4a"
    return f"{res},ext:mp4:m4a"


def download_args(cfg: Config, opts: DownloadOptions, url: str, work: Path) -> list[str]:
    args = base_args(cfg) + [
        "--no-playlist", "--no-mtime", "--continue", "--newline", "--progress",
        "--concurrent-fragments", "4",
        "--progress-template", PROGRESS_TEMPLATE,
        "--print", PRE_TEMPLATE,
        "--print", "post_process:" + POST_PREFIX,
        "--print", DONE_TEMPLATE,
        "--paths", f"home:{work}", "--paths", f"temp:{work}",
        "-o", "media.%(ext)s",
        "-o", "thumbnail:thumb.%(ext)s",
        "-o", "subtitle:media.%(ext)s",
        "--write-thumbnail", "--convert-thumbnails", "jpg",
        "--embed-metadata", "--no-embed-info-json",
    ]
    if opts.kind == "audio":
        fmt_sort = {"mp3": "abr", "m4a": "ext:m4a,abr", "opus": "acodec:opus,abr", "wav": "abr"}
        args += ["-f", "ba/b", "-S", fmt_sort[opts.audioFormat], "-x",
                 "--audio-format", opts.audioFormat]
        if opts.audioFormat == "mp3":
            args += ["--audio-quality", f"{opts.audioBitrate}K"]
        else:
            args += ["--audio-quality", "0"]
    else:
        args += ["-f", "bv*+ba/b", "-S", video_sort(opts),
                 "--merge-output-format", opts.container, "--embed-chapters"]
        if opts.subtitles:
            args += ["--write-subs", "--sub-langs", opts.subtitles, "--embed-subs"]
            if opts.autoSubs:
                args.append("--write-auto-subs")
    start, end = opts.trim_seconds()
    if start is not None or end is not None:
        section = f"*{start or 0:.3f}-{'inf' if end is None else f'{end:.3f}'}"
        args += ["--download-sections", section, "--force-keyframes-at-cuts"]
    args += ["--", url]
    return args


# -- preview --------------------------------------------------------------

def _best_thumb(info: dict[str, Any]) -> str | None:
    thumbs = info.get("thumbnails") or []
    candidates = [t for t in thumbs if isinstance(t, dict) and str(t.get("url", "")).startswith("http")]
    if candidates:
        def score(t: dict[str, Any]) -> tuple[int, int]:
            return (int(t.get("preference") or 0), int(t.get("width") or 0))
        good = [t for t in candidates if (t.get("width") or 0) <= 1280] or candidates
        return max(good, key=score)["url"]
    thumb = info.get("thumbnail")
    return thumb if isinstance(thumb, str) and thumb.startswith("http") else None


def _entry_url(entry: dict[str, Any]) -> str | None:
    for key in ("url", "webpage_url", "original_url"):
        v = entry.get(key)
        if isinstance(v, str) and v.startswith(("http://", "https://")):
            return v
    return None


def summarize(info: dict[str, Any]) -> dict[str, Any]:
    channel = info.get("channel") or info.get("uploader") or info.get("creator") or info.get("artist")
    base = {
        "id": info.get("id"),
        "title": info.get("title") or info.get("id") or "Untitled",
        "channel": channel,
        "url": info.get("webpage_url") or info.get("original_url"),
        "thumbnail": _best_thumb(info),
        "site": info.get("extractor_key") or info.get("extractor"),
    }
    if info.get("_type") == "playlist":
        entries = []
        for e in (info.get("entries") or [])[:MAX_PLAYLIST_ENTRIES]:
            if not isinstance(e, dict):
                continue
            url = _entry_url(e)
            if not url:
                continue
            entries.append({
                "id": e.get("id"),
                "title": e.get("title") or e.get("id") or "Untitled",
                "url": url,
                "duration": e.get("duration"),
                "channel": e.get("channel") or e.get("uploader"),
                "thumbnail": _best_thumb(e),
            })
        return {**base, "type": "playlist", "count": info.get("playlist_count") or len(entries),
                "entries": entries, "truncated": len(info.get("entries") or []) > MAX_PLAYLIST_ENTRIES}

    formats = [f for f in info.get("formats") or [] if isinstance(f, dict)]
    heights = sorted({int(f["height"]) for f in formats
                      if f.get("height") and f.get("vcodec") != "none"}, reverse=True)
    if not heights and info.get("height"):
        heights = [int(info["height"])]
    # Unknown codecs (None) may still be video; only an explicit "none" means audio-only.
    has_video = bool(heights) or any(f.get("vcodec") != "none" for f in formats) or not formats
    abrs = sorted({round(float(f["abr"])) for f in formats if f.get("abr") and f.get("acodec") != "none"},
                  reverse=True)
    rows = []
    for f in formats:
        if f.get("vcodec") in (None, "none") and f.get("acodec") in (None, "none") and not f.get("height"):
            continue
        rows.append({
            "id": f.get("format_id"),
            "ext": f.get("ext"),
            "height": f.get("height"),
            "fps": f.get("fps"),
            "vcodec": f["vcodec"].split(".")[0] if f.get("vcodec") else None,
            "acodec": f["acodec"].split(".")[0] if f.get("acodec") else None,
            "abr": f.get("abr"),
            "size": f.get("filesize") or f.get("filesize_approx"),
            "note": f.get("format_note"),
        })
    subs = sorted((info.get("subtitles") or {}).keys())
    auto = sorted((info.get("automatic_captions") or {}).keys())
    return {
        **base,
        "type": "video",
        "duration": info.get("duration"),
        "uploadDate": info.get("upload_date"),
        "isLive": bool(info.get("is_live")),
        "ageLimit": info.get("age_limit") or 0,
        "hasVideo": has_video,
        "heights": heights,
        "audioBitrates": abrs[:8],
        "formats": rows[-60:],
        "subtitles": [s for s in subs if s != "live_chat"][:200],
        "autoSubtitles": auto[:200],
        "artist": info.get("artist") or info.get("creator"),
        "album": info.get("album"),
    }


class YtdlpError(Exception):
    def __init__(self, err: FriendlyError) -> None:
        super().__init__(err.message)
        self.err = err


async def preview(cfg: Config, url: str) -> dict[str, Any]:
    args = base_args(cfg) + ["-J", "--no-playlist", "--flat-playlist", "--no-warnings", "--", url]
    proc = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        env=child_env(cfg), start_new_session=True,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), PREVIEW_TIMEOUT)
    except asyncio.TimeoutError:
        kill_tree(proc)
        raise YtdlpError(FriendlyError("timeout", "The site took too long to respond. Try again."))
    if proc.returncode != 0:
        raise YtdlpError(friendly(err.decode("utf-8", "replace")))
    try:
        info = json.loads(out)
    except json.JSONDecodeError as exc:
        raise YtdlpError(FriendlyError("unknown", "Couldn't read the video information.")) from exc
    return summarize(info)


def kill_tree(proc: asyncio.subprocess.Process, sig: int = signal.SIGTERM) -> None:
    if proc.returncode is not None:
        return
    try:
        os.killpg(proc.pid, sig)
    except (ProcessLookupError, PermissionError):
        try:
            proc.send_signal(sig)
        except ProcessLookupError:
            pass


async def version(cfg: Config) -> str:
    proc = await asyncio.create_subprocess_exec(
        *base_args(cfg)[:3], "--version", stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL, env=child_env(cfg),
    )
    out, _ = await proc.communicate()
    return out.decode().strip() or "unknown"


async def update(cfg: Config) -> tuple[bool, str]:
    """pip-install the latest yt-dlp into ytdlp_target; picked up by the next job, no restart."""
    cfg.ytdlp_target.mkdir(parents=True, exist_ok=True)
    proc = await asyncio.create_subprocess_exec(
        sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--no-cache-dir",
        "--upgrade", "--target", str(cfg.ytdlp_target), "yt-dlp[default,curl-cffi]",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
    )
    out, _ = await asyncio.wait_for(proc.communicate(), 600)
    return proc.returncode == 0, out.decode("utf-8", "replace")[-2000:]

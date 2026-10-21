"""ffprobe/ffmpeg helpers and tag/cover writing with mutagen."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from pathlib import Path
from typing import Any, Awaitable, Callable

log = logging.getLogger("dubdeck.media")

H264 = {"h264"}
MP4_AUDIO = {"aac"}
WEBM_VIDEO = {"vp8", "vp9", "av1"}
WEBM_AUDIO = {"opus", "vorbis"}


async def probe(path: Path) -> dict[str, Any]:
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(path),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
    )
    out, _ = await proc.communicate()
    try:
        return json.loads(out or b"{}")
    except json.JSONDecodeError:
        return {}


def stream_info(meta: dict[str, Any]) -> dict[str, Any]:
    """The first real video stream (not cover art) and first audio stream."""
    v = next((s for s in meta.get("streams", []) if s.get("codec_type") == "video"
              and not (s.get("disposition") or {}).get("attached_pic")), None)
    a = next((s for s in meta.get("streams", []) if s.get("codec_type") == "audio"), None)
    try:
        duration = float((meta.get("format") or {}).get("duration") or 0) or None
    except ValueError:
        duration = None
    return {
        "vcodec": v.get("codec_name") if v else None,
        "acodec": a.get("codec_name") if a else None,
        "width": v.get("width") if v else None,
        "height": v.get("height") if v else None,
        "duration": duration,
    }


def needs_transcode(container: str, info: dict[str, Any]) -> tuple[bool, bool]:
    """(re-encode video?, re-encode audio?) to meet the container's compatibility target."""
    v, a = info.get("vcodec"), info.get("acodec")
    if container == "mp4":
        return (v is not None and v not in H264, a is not None and a not in MP4_AUDIO)
    return (v is not None and v not in WEBM_VIDEO, a is not None and a not in WEBM_AUDIO)


def transcode_args(src: Path, dst: Path, container: str, video: bool, audio: bool) -> list[str]:
    args = ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-i", str(src),
            "-map", "0:v:0?", "-map", "0:a:0?", "-map", "0:s?", "-map_metadata", "0",
            "-map_chapters", "0"]
    if container == "mp4":
        args += (["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
                  "-profile:v", "high"] if video else ["-c:v", "copy"])
        args += ["-c:a", "aac", "-b:a", "192k"] if audio else ["-c:a", "copy"]
        args += ["-c:s", "mov_text", "-movflags", "+faststart"]
    else:
        args += (["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32", "-row-mt", "1",
                  "-deadline", "good", "-cpu-used", "4"] if video else ["-c:v", "copy"])
        args += ["-c:a", "libopus", "-b:a", "160k"] if audio else ["-c:a", "copy"]
        args += ["-c:s", "webvtt"]
    args += ["-progress", "pipe:1", "-nostats", str(dst)]
    return args


async def run_ffmpeg(args: list[str], duration: float | None,
                     on_progress: Callable[[float], Awaitable[None]],
                     register: Callable[[asyncio.subprocess.Process], None]) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, start_new_session=True,
    )
    register(proc)
    assert proc.stdout is not None and proc.stderr is not None
    err_task = asyncio.create_task(proc.stderr.read())
    async for raw in proc.stdout:
        line = raw.decode("utf-8", "replace").strip()
        if line.startswith("out_time_us=") and duration:
            try:
                await on_progress(min(1.0, int(line.split("=", 1)[1]) / 1e6 / duration))
            except ValueError:
                pass
    code = await proc.wait()
    return code, (await err_task).decode("utf-8", "replace")[-2000:]


# -- tags -----------------------------------------------------------------

def write_tags(path: Path, ext: str, title: str | None, artist: str | None, album: str | None,
               cover: Path | None) -> None:
    """Write title/artist/album (+ cover art) tags. Failures are logged, never fatal."""
    try:
        _write_tags(path, ext, title, artist, album,
                    cover.read_bytes() if cover and cover.is_file() else None)
    except Exception as exc:  # tagging must never lose a finished download
        log.warning("tagging %s failed: %s", path.name, exc)


def _id3_frames(tags: Any, title: str | None, artist: str | None, album: str | None,
                cover: bytes | None) -> None:
    from mutagen.id3 import APIC, TALB, TIT2, TPE1

    if title:
        tags.setall("TIT2", [TIT2(encoding=3, text=title)])
    if artist:
        tags.setall("TPE1", [TPE1(encoding=3, text=artist)])
    if album:
        tags.setall("TALB", [TALB(encoding=3, text=album)])
    if cover:
        tags.setall("APIC", [APIC(encoding=3, mime="image/jpeg", type=3, desc="Cover", data=cover)])


def _write_tags(path: Path, ext: str, title: str | None, artist: str | None, album: str | None,
                cover: bytes | None) -> None:
    if ext == "mp3":
        from mutagen.id3 import ID3, ID3NoHeaderError

        try:
            tags = ID3(str(path))
        except ID3NoHeaderError:
            tags = ID3()
        _id3_frames(tags, title, artist, album, cover)
        tags.save(str(path), v2_version=3)
    elif ext == "wav":
        from mutagen.wave import WAVE

        audio = WAVE(str(path))
        if audio.tags is None:
            audio.add_tags()
        _id3_frames(audio.tags, title, artist, album, cover)
        audio.save()
    elif ext in {"m4a", "mp4"}:
        from mutagen.mp4 import MP4, MP4Cover

        audio = MP4(str(path))
        if audio.tags is None:
            audio.add_tags()
        if title:
            audio.tags["\xa9nam"] = [title]
        if artist:
            audio.tags["\xa9ART"] = [artist]
        if album:
            audio.tags["\xa9alb"] = [album]
        if cover:
            audio.tags["covr"] = [MP4Cover(cover, imageformat=MP4Cover.FORMAT_JPEG)]
        audio.save()
    elif ext in {"opus", "ogg"}:
        from mutagen import File as MutagenFile
        from mutagen.flac import Picture

        audio = MutagenFile(str(path))
        if audio is None:
            return
        if title:
            audio["title"] = [title]
        if artist:
            audio["artist"] = [artist]
        if album:
            audio["album"] = [album]
        if cover:
            pic = Picture()
            pic.type, pic.mime, pic.desc, pic.data = 3, "image/jpeg", "Cover", cover
            audio["metadata_block_picture"] = [base64.b64encode(pic.write()).decode("ascii")]
        audio.save()

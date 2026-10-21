"""Request/settings schemas. Everything the browser sends is validated here."""

from __future__ import annotations

import re
import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Quality = Literal["best", "2160", "1440", "1080", "720", "480", "360"]
AudioFormat = Literal["mp3", "m4a", "opus", "wav"]
Bitrate = Literal[320, 256, 192, 128]

_TIME_RE = re.compile(r"^(?:(\d{1,2}):)?(?:(\d{1,2}):)?(\d{1,5})(?:\.(\d{1,3}))?$")
_LANG_RE = re.compile(r"^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{1,8}){0,3}$")
_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def parse_timestamp(value: str) -> float:
    """'90', '1:30', '01:02:03.5' -> seconds."""
    m = _TIME_RE.match(value.strip())
    if not m:
        raise ValueError("use seconds or h:mm:ss")
    a, b, c, frac = m.groups()
    parts = [int(p) for p in (a, b) if p is not None]
    seconds = int(c)
    if parts and seconds >= 60:
        raise ValueError("seconds must be below 60")
    total = 0
    for p in parts:
        total = total * 60 + p
    total = total * 60 + seconds if parts else seconds
    return total + (int(frac.ljust(3, "0")) / 1000 if frac else 0.0)


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Tags(Strict):
    title: str | None = Field(default=None, max_length=300)
    artist: str | None = Field(default=None, max_length=300)
    album: str | None = Field(default=None, max_length=300)


class PresetOptions(Strict):
    kind: Literal["video", "audio"] = "video"
    quality: Quality = "best"
    container: Literal["mp4", "webm"] = "mp4"
    mp4Compat: Literal["strict", "fast"] = "strict"
    audioFormat: AudioFormat = "mp3"
    audioBitrate: Bitrate = 320
    embedCover: bool = True
    subtitles: str | None = Field(default=None, max_length=32)
    autoSubs: bool = False
    filenameTemplate: str = Field(default="{title}", min_length=1, max_length=200)

    @field_validator("subtitles")
    @classmethod
    def _lang(cls, v: str | None) -> str | None:
        if v in (None, ""):
            return None
        if not _LANG_RE.match(v):
            raise ValueError("subtitle language must be a code like 'en' or 'pt-BR'")
        return v


class DownloadOptions(PresetOptions):
    trimStart: str | None = Field(default=None, max_length=16)
    trimEnd: str | None = Field(default=None, max_length=16)
    tags: Tags | None = None

    @model_validator(mode="after")
    def _trim(self) -> "DownloadOptions":
        start = parse_timestamp(self.trimStart) if self.trimStart else None
        end = parse_timestamp(self.trimEnd) if self.trimEnd else None
        if start is not None and end is not None and end <= start:
            raise ValueError("trim end must be after trim start")
        return self

    def trim_seconds(self) -> tuple[float | None, float | None]:
        return (
            parse_timestamp(self.trimStart) if self.trimStart else None,
            parse_timestamp(self.trimEnd) if self.trimEnd else None,
        )


class JobItem(Strict):
    url: str = Field(max_length=2048)
    title: str | None = Field(default=None, max_length=500)
    channel: str | None = Field(default=None, max_length=300)
    thumbnail: str | None = Field(default=None, max_length=2048)
    duration: float | None = Field(default=None, ge=0, le=10 * 86400)


class CreateJobs(Strict):
    items: list[JobItem] = Field(min_length=1, max_length=200)
    options: DownloadOptions


class PreviewRequest(Strict):
    url: str = Field(max_length=2048)


class GoogleLogin(Strict):
    credential: str = Field(min_length=10, max_length=8192)


class PasscodeLogin(Strict):
    passcode: str = Field(min_length=1, max_length=256)


class EmailStart(Strict):
    email: str = Field(min_length=3, max_length=320)


class EmailVerify(Strict):
    email: str = Field(min_length=3, max_length=320)
    code: str = Field(pattern=r"^\d{6}$")


class DevLogin(Strict):
    email: str = Field(max_length=320)


class Logout(Strict):
    everywhere: bool = False


class Rename(Strict):
    name: str = Field(min_length=1, max_length=200)


class BulkDelete(Strict):
    ids: list[str] = Field(min_length=1, max_length=1000)


class LinkRequest(Strict):
    disposition: Literal["attachment", "inline"] = "attachment"


# -- settings -------------------------------------------------------------

class Preset(Strict):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12], pattern=r"^[A-Za-z0-9_-]{1,40}$")
    name: str = Field(min_length=1, max_length=60)
    options: PresetOptions


class Appearance(Strict):
    theme: Literal["light", "dark", "system"] = "system"
    accent: str = "#e4572e"
    density: Literal["comfortable", "compact"] = "comfortable"
    fontSize: int = Field(default=15, ge=12, le=20)
    reducedMotion: Literal["system", "on", "off"] = "system"

    @field_validator("accent")
    @classmethod
    def _hex(cls, v: str) -> str:
        if not _HEX_RE.match(v):
            raise ValueError("accent must be a #rrggbb color")
        return v.lower()


class Defaults(Strict):
    presetId: str = Field(default="video-best-mp4", max_length=40)
    audioFormat: AudioFormat = "mp3"
    audioBitrate: Bitrate = 320
    filenameTemplate: str = Field(default="{title}", min_length=1, max_length=200)
    concurrentDownloads: int = Field(default=2, ge=1, le=6)
    mp4Compat: Literal["strict", "fast"] = "strict"
    embedCover: bool = True
    subtitleLang: str | None = Field(default=None, max_length=32)


class Storage(Strict):
    quotaGB: float = Field(default=50.0, ge=0.1, le=100_000)
    autoCleanup: bool = False
    maxAgeDays: int | None = Field(default=None, ge=1, le=3650)
    deleteOverQuota: bool = False


def default_presets() -> list[Preset]:
    return [
        Preset(id="video-best-mp4", name="Best video · MP4", options=PresetOptions()),
        Preset(id="video-1080-mp4", name="1080p · MP4", options=PresetOptions(quality="1080")),
        Preset(id="video-720-mp4", name="720p · MP4 (small)", options=PresetOptions(quality="720")),
        Preset(id="video-best-webm", name="Best video · WebM", options=PresetOptions(container="webm")),
        Preset(id="audio-mp3-320", name="Audio · MP3 320", options=PresetOptions(kind="audio")),
        Preset(id="audio-m4a", name="Audio · M4A/AAC",
               options=PresetOptions(kind="audio", audioFormat="m4a")),
        Preset(id="audio-opus", name="Audio · Opus",
               options=PresetOptions(kind="audio", audioFormat="opus")),
    ]


class Settings(Strict):
    appearance: Appearance = Field(default_factory=Appearance)
    defaults: Defaults = Field(default_factory=Defaults)
    storage: Storage = Field(default_factory=Storage)
    presets: list[Preset] = Field(default_factory=default_presets, max_length=50)

    @model_validator(mode="after")
    def _unique_presets(self) -> "Settings":
        ids = [p.id for p in self.presets]
        if len(ids) != len(set(ids)):
            raise ValueError("preset ids must be unique")
        return self


class SettingsUpdate(Strict):
    settings: Settings
    baseUpdatedAt: float | None = None

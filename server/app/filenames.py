"""Filename templates like '{title} - {channel}', rendered by us (never by yt-dlp)."""

from __future__ import annotations

import re
import unicodedata

TOKENS = ("title", "channel", "artist", "album", "id", "date", "quality", "format", "site")
_TOKEN_RE = re.compile(r"\{([a-z]+)\}")
_BAD_CHARS = re.compile(r'[\x00-\x1f\x7f<>:"/\\|?*]')
_RESERVED = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}
MAX_NAME = 180


def sanitize(name: str) -> str:
    """Make a display name safe as a filename on Windows, macOS, Linux, Android, iOS."""
    name = unicodedata.normalize("NFC", name)
    name = _BAD_CHARS.sub(" ", name)
    name = re.sub(r"\s+", " ", name).strip(" .")
    if name.upper().split(".")[0] in _RESERVED:
        name = f"_{name}"
    if len(name) > MAX_NAME:
        name = name[:MAX_NAME].rstrip(" .")
    return name or "download"


def render(template: str, values: dict[str, str | None]) -> str:
    def sub(m: re.Match[str]) -> str:
        key = m.group(1)
        if key not in TOKENS:
            return m.group(0)
        return (values.get(key) or "").strip().replace(EMPTY, "") or EMPTY

    out = _TOKEN_RE.sub(sub, template)
    # An empty token takes one neighbouring separator or bracket pair with it:
    # "{title} - {channel}" -> "Title", "{title} ({date})" -> "Title".
    out = re.sub(rf"[\[(]\s*{EMPTY}\s*[\])]", EMPTY, out)
    out = re.sub(rf"{_SEP}{EMPTY}", "", out)
    out = re.sub(rf"{EMPTY}{_SEP}", "", out)
    out = out.replace(EMPTY, "")
    out = re.sub(rf"^{_SEP}|{_SEP}$", "", out)
    return sanitize(out or values.get("title") or "download")


EMPTY = "\x00"
_SEP = r"\s*[-–—_·|,]\s*"

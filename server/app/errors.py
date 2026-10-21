"""Turn yt-dlp's stderr into short, friendly messages."""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class FriendlyError:
    code: str
    message: str
    detail: str = ""

    def as_dict(self) -> dict[str, str]:
        return {"code": self.code, "message": self.message, "detail": self.detail}


# Order matters: first match wins.
_RULES: list[tuple[str, str, str]] = [
    ("unsupported_site", r"Unsupported URL|no suitable InfoExtractor|is not a valid URL",
     "This site isn't supported, or the link doesn't point to a video or audio page."),
    ("private", r"Private video|This video is private|privacy setting|members-only|"
                r"Join this channel to get access|requires a subscription|This playlist is private",
     "This video is private or members-only, so it can't be downloaded."),
    ("age_restricted", r"Sign in to confirm your age|age[- ]restricted|inappropriate for some users|"
                       r"age verification|confirm your age",
     "This video is age-restricted. Add a cookies file from a signed-in browser to download it."),
    ("region_blocked", r"available in your country|geo.?restrict|blocked it in your country|"
                       r"not available in your (?:location|region)|from your location",
     "This video is blocked in the server's region."),
    ("bot_check", r"confirm you(?:'|’)re not a bot|Sign in to confirm",
     "The site is asking the server to prove it isn't a bot. Add a cookies file, or try again later."),
    ("login_required", r"login required|logged-in|account credentials|--username and --password|"
                       r"Use --cookies",
     "This site requires you to be signed in. Add a cookies file to download from it."),
    ("removed", r"has been removed|account (?:associated|has been terminated)|"
                r"no longer available|Video unavailable|This video is unavailable|HTTP Error 404|"
                r"does not exist",
     "This video is unavailable. It may have been removed."),
    ("live", r"live event will begin|Premieres in|is_live|This live event|is currently live",
     "Live streams and upcoming premieres can't be downloaded yet."),
    ("drm", r"DRM|protected by", "This content is DRM-protected and can't be downloaded."),
    ("rate_limited", r"HTTP Error 429|Too Many Requests|rate.?limit",
     "The site is rate-limiting the server. Wait a few minutes and retry."),
    ("format_unavailable", r"Requested format is not available|No video formats found",
     "That quality or format isn't available for this video. Try another preset."),
    ("subtitles_unavailable", r"There are no subtitles for the requested languages|"
                              r"no subtitles for",
     "Subtitles in that language aren't available."),
    ("network", r"timed out|Connection reset|Temporary failure in name resolution|"
                r"Network is unreachable|Unable to download webpage|getaddrinfo failed|"
                r"Remote end closed connection|SSL",
     "Network problem while contacting the site. Check the server's connection and retry."),
    ("disk_full", r"No space left on device|Disk quota exceeded",
     "The server's disk is full. Free up space in the Library."),
    ("ffmpeg", r"ffmpeg|ffprobe|Postprocessing|Conversion failed",
     "Converting the file failed. Try a different format."),
]

_COMPILED = [(code, re.compile(pat, re.IGNORECASE), msg) for code, pat, msg in _RULES]
_ANSI = re.compile(r"\x1b\[[0-9;]*m")


def last_error_line(stderr: str) -> str:
    lines = [_ANSI.sub("", ln).strip() for ln in stderr.splitlines() if ln.strip()]
    errors = [ln for ln in lines if ln.startswith("ERROR:")]
    line = errors[-1] if errors else (lines[-1] if lines else "")
    return line.removeprefix("ERROR:").strip()[:500]


def friendly(stderr: str) -> FriendlyError:
    detail = last_error_line(stderr)
    haystack = detail or stderr[-4000:]
    for code, pat, msg in _COMPILED:
        if pat.search(haystack):
            return FriendlyError(code, msg, detail)
    return FriendlyError("unknown", "The download failed. See details for the technical reason.", detail)

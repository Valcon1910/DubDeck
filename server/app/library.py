"""Downloaded files: listing, stats, rename/delete, and auto-cleanup."""

from __future__ import annotations

import logging
import shutil
import time
import uuid
from pathlib import Path
from typing import Any

from .config import Config
from .db import Database
from .filenames import sanitize
from .models import Storage
from .signing import Signer

log = logging.getLogger("dubdeck.library")

CONTENT_TYPES = {
    "mp4": "video/mp4", "webm": "video/webm", "mkv": "video/x-matroska",
    "mp3": "audio/mpeg", "m4a": "audio/mp4", "opus": "audio/ogg", "ogg": "audio/ogg",
    "wav": "audio/wav", "flac": "audio/flac", "jpg": "image/jpeg",
}


class Library:
    def __init__(self, cfg: Config, db: Database, signer: Signer) -> None:
        self.cfg = cfg
        self.db = db
        self.signer = signer
        for d in (cfg.media_dir, cfg.thumbs_dir, cfg.work_dir):
            d.mkdir(parents=True, exist_ok=True)

    # -- paths ----------------------------------------------------------
    def media_path(self, row: dict[str, Any]) -> Path:
        return self.cfg.media_dir / row["disk_name"]

    def thumb_path(self, file_id: str) -> Path:
        return self.cfg.thumbs_dir / f"{file_id}.jpg"

    # -- add ------------------------------------------------------------
    def add(self, *, job_id: str, src: Path, thumb: Path | None, name: str, kind: str,
            quality: str, meta: dict[str, Any]) -> dict[str, Any]:
        file_id = uuid.uuid4().hex
        ext = src.suffix.lstrip(".").lower()
        disk_name = f"{file_id}.{ext}"
        dst = self.cfg.media_dir / disk_name
        shutil.move(str(src), dst)
        has_thumb = False
        if thumb and thumb.is_file():
            shutil.move(str(thumb), self.thumb_path(file_id))
            has_thumb = True
        row = {
            "id": file_id, "job_id": job_id, "name": sanitize(name), "disk_name": disk_name,
            "kind": kind, "ext": ext, "size": dst.stat().st_size, "quality": quality,
            "duration": meta.get("duration"), "width": meta.get("width"), "height": meta.get("height"),
            "vcodec": meta.get("vcodec"), "acodec": meta.get("acodec"), "title": meta.get("title"),
            "channel": meta.get("channel"), "source_url": meta.get("source_url"),
            "has_thumb": int(has_thumb), "created_at": time.time(),
        }
        cols = ", ".join(row)
        self.db.execute(f"INSERT INTO files({cols}) VALUES({', '.join('?' * len(row))})", row.values())
        return row

    # -- read -----------------------------------------------------------
    def get(self, file_id: str) -> dict[str, Any] | None:
        return self.db.one("SELECT * FROM files WHERE id = ?", (file_id,))

    def public(self, row: dict[str, Any]) -> dict[str, Any]:
        thumb_url = None
        if row["has_thumb"]:
            token, _ = self.signer.sign(row["id"], "thumb", "inline")
            thumb_url = f"{self.cfg.public_url}/f/{token}"
        return {
            "id": row["id"], "name": row["name"], "filename": f"{row['name']}.{row['ext']}",
            "kind": row["kind"], "ext": row["ext"], "size": row["size"], "quality": row["quality"],
            "duration": row["duration"], "width": row["width"], "height": row["height"],
            "vcodec": row["vcodec"], "acodec": row["acodec"], "title": row["title"],
            "channel": row["channel"], "sourceUrl": row["source_url"], "createdAt": row["created_at"],
            "thumbUrl": thumb_url, "jobId": row["job_id"],
        }

    def list(self) -> list[dict[str, Any]]:
        return [self.public(r) for r in self.db.all("SELECT * FROM files ORDER BY created_at DESC")]

    def link(self, file_id: str, disposition: str) -> dict[str, Any] | None:
        if not self.get(file_id):
            return None
        token, exp = self.signer.sign(file_id, "media", disposition)
        return {"url": f"{self.cfg.public_url}/f/{token}", "expiresAt": exp}

    def stats(self, storage: Storage) -> dict[str, Any]:
        rows = self.db.all("SELECT kind, COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM files GROUP BY kind")
        by_kind = {r["kind"]: {"count": r["n"], "bytes": r["bytes"]} for r in rows}
        total = sum(r["bytes"] for r in rows)
        largest = self.db.all("SELECT * FROM files ORDER BY size DESC LIMIT 8")
        try:
            disk = shutil.disk_usage(self.cfg.media_dir)
            disk_info = {"total": disk.total, "free": disk.free}
        except OSError:
            disk_info = None
        return {
            "usedBytes": total,
            "quotaBytes": int(storage.quotaGB * 1024 ** 3),
            "byKind": {k: by_kind.get(k, {"count": 0, "bytes": 0}) for k in ("video", "audio")},
            "count": sum(r["n"] for r in rows),
            "largest": [self.public(r) for r in largest],
            "disk": disk_info,
        }

    # -- write ----------------------------------------------------------
    def rename(self, file_id: str, name: str) -> dict[str, Any] | None:
        if not self.get(file_id):
            return None
        self.db.execute("UPDATE files SET name = ? WHERE id = ?", (sanitize(name), file_id))
        return self.public(self.get(file_id))  # type: ignore[arg-type]

    def delete(self, ids: list[str]) -> int:
        n = 0
        for file_id in ids:
            row = self.get(file_id)
            if not row:
                continue
            self.media_path(row).unlink(missing_ok=True)
            self.thumb_path(file_id).unlink(missing_ok=True)
            self.db.execute("DELETE FROM files WHERE id = ?", (file_id,))
            n += 1
        return n

    def cleanup(self, storage: Storage, force: bool = False) -> list[str]:
        """Apply auto-cleanup rules. Returns deleted ids (oldest first)."""
        if not storage.autoCleanup and not force:
            return []
        doomed: list[str] = []
        if storage.maxAgeDays:
            cutoff = time.time() - storage.maxAgeDays * 86400
            doomed += [r["id"] for r in self.db.all(
                "SELECT id FROM files WHERE created_at < ? ORDER BY created_at", (cutoff,))]
        if storage.deleteOverQuota:
            quota = storage.quotaGB * 1024 ** 3
            rows = self.db.all("SELECT id, size FROM files ORDER BY created_at")
            total = sum(r["size"] for r in rows if r["id"] not in doomed)
            for r in rows:
                if total <= quota:
                    break
                if r["id"] in doomed:
                    continue
                doomed.append(r["id"])
                total -= r["size"]
        if doomed:
            self.delete(doomed)
            log.info("auto-cleanup removed %d file(s)", len(doomed))
        return doomed

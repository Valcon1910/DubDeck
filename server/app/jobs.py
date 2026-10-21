"""Download queue: scheduling, progress, pause/resume/cancel/retry, history."""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
import signal
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import media, ytdlp
from .config import Config
from .db import Database
from .errors import FriendlyError, friendly
from .events import EventBus
from .filenames import render
from .library import Library
from .models import DownloadOptions, JobItem
from .settings_store import SettingsStore

log = logging.getLogger("dubdeck.jobs")

FINAL = ("completed", "failed", "canceled")
PUBLISH_INTERVAL = 0.3


@dataclass
class Live:
    phase: str = "queued"
    progress: float | None = 0.0
    speed: float | None = None
    eta: float | None = None
    downloaded: int = 0
    total: int | None = None
    stream: int = 0
    streams: int = 1
    procs: list[asyncio.subprocess.Process] = field(default_factory=list)
    stop_reason: str | None = None
    last_publish: float = 0.0


class JobManager:
    def __init__(self, cfg: Config, db: Database, bus: EventBus, library: Library,
                 settings: SettingsStore) -> None:
        self.cfg, self.db, self.bus, self.library, self.settings = cfg, db, bus, library, settings
        self.live: dict[str, Live] = {}
        self.tasks: dict[str, asyncio.Task[None]] = {}
        self._wake = asyncio.Event()
        self._scheduler_task: asyncio.Task[None] | None = None

    # -- lifecycle ------------------------------------------------------
    async def start(self) -> None:
        # Jobs interrupted by a restart resume from their partial files.
        self.db.execute("UPDATE jobs SET status = 'queued' WHERE status = 'running'")
        self._scheduler_task = asyncio.create_task(self._scheduler())

    async def stop(self) -> None:
        if self._scheduler_task:
            self._scheduler_task.cancel()
        for job_id in list(self.tasks):
            self._stop(job_id, "shutdown")
        if self.tasks:
            await asyncio.wait(list(self.tasks.values()), timeout=10)

    def wake(self) -> None:
        self._wake.set()

    # -- views ----------------------------------------------------------
    def _row(self, job_id: str) -> dict[str, Any] | None:
        return self.db.one("SELECT * FROM jobs WHERE id = ?", (job_id,))

    def serialize(self, row: dict[str, Any]) -> dict[str, Any]:
        live = self.live.get(row["id"])
        file_exists = bool(row["file_id"] and self.library.get(row["file_id"]))
        out = {
            "id": row["id"], "url": row["url"], "status": row["status"], "title": row["title"],
            "channel": row["channel"], "thumbnail": row["thumbnail"], "duration": row["duration"],
            "options": json.loads(row["options"]), "fileId": row["file_id"] if file_exists else None,
            "createdAt": row["created_at"], "startedAt": row["started_at"],
            "finishedAt": row["finished_at"], "attempts": row["attempts"],
            "error": ({"code": row["error_code"], "message": row["error_msg"]}
                      if row["error_code"] else None),
            "phase": row["status"], "progress": 1.0 if row["status"] == "completed" else 0.0,
            "speed": None, "eta": None, "downloaded": 0, "total": None, "stream": 0, "streams": 1,
        }
        if live and row["status"] == "running":
            out.update(phase=live.phase, progress=live.progress, speed=live.speed, eta=live.eta,
                       downloaded=live.downloaded, total=live.total, stream=live.stream,
                       streams=live.streams)
        if row["error_code"]:
            detail = self.db.one("SELECT value FROM kv WHERE key = ?", (f"joberr:{row['id']}",))
            if detail and out["error"] is not None:
                out["error"]["detail"] = json.loads(detail["value"])
        return out

    def list(self, limit: int = 300) -> list[dict[str, Any]]:
        rows = self.db.all("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,))
        return [self.serialize(r) for r in rows]

    def get(self, job_id: str) -> dict[str, Any] | None:
        row = self._row(job_id)
        return self.serialize(row) if row else None

    def _publish(self, job_id: str, force: bool = True) -> None:
        live = self.live.get(job_id)
        now = time.monotonic()
        if not force and live and now - live.last_publish < PUBLISH_INTERVAL:
            return
        if live:
            live.last_publish = now
        row = self._row(job_id)
        if row:
            self.bus.publish("job", self.serialize(row))
        else:
            self.bus.publish("job_removed", {"id": job_id})

    # -- commands -------------------------------------------------------
    def create(self, items: list[JobItem], urls: list[str], options: DownloadOptions) -> list[dict[str, Any]]:
        now = time.time()
        created = []
        for i, (item, url) in enumerate(zip(items, urls)):
            job_id = uuid.uuid4().hex[:16]
            thumb = item.thumbnail if item.thumbnail and item.thumbnail.startswith("https://") else None
            self.db.execute(
                "INSERT INTO jobs(id, url, options, status, title, channel, thumbnail, duration, "
                "created_at) VALUES(?, ?, ?, 'queued', ?, ?, ?, ?, ?)",
                (job_id, url, options.model_dump_json(), item.title, item.channel, thumb,
                 item.duration, now + i * 1e-4),
            )
            created.append(job_id)
            self._publish(job_id)
        self.wake()
        return [self.get(j) for j in created]  # type: ignore[misc]

    def _set(self, job_id: str, **cols: Any) -> None:
        sets = ", ".join(f"{k} = ?" for k in cols)
        self.db.execute(f"UPDATE jobs SET {sets} WHERE id = ?", (*cols.values(), job_id))

    def _stop(self, job_id: str, reason: str) -> None:
        live = self.live.get(job_id)
        if not live:
            return
        live.stop_reason = reason
        procs = list(live.procs)
        for proc in procs:
            ytdlp.kill_tree(proc)
        # Escalate only for these processes; the job may be resumed with new ones by then.
        asyncio.get_running_loop().call_later(5, self._force_kill, procs)

    @staticmethod
    def _force_kill(procs: list[asyncio.subprocess.Process]) -> None:
        for proc in procs:
            ytdlp.kill_tree(proc, signal.SIGKILL)

    def action(self, job_id: str, action: str) -> dict[str, Any] | None:
        row = self._row(job_id)
        if not row:
            return None
        status = row["status"]
        if action == "pause" and status in ("queued", "running"):
            if status == "running":
                self._stop(job_id, "pause")
            else:
                self._set(job_id, status="paused")
        elif action == "resume" and status == "paused":
            self._set(job_id, status="queued")
            self.wake()
        elif action == "cancel" and status in ("queued", "running", "paused"):
            if status == "running":
                self._stop(job_id, "cancel")
            else:
                self._set(job_id, status="canceled", finished_at=time.time())
                shutil.rmtree(self.cfg.work_dir / job_id, ignore_errors=True)
        elif action == "retry" and status in ("failed", "canceled"):
            self._set(job_id, status="queued", error_code=None, error_msg=None, finished_at=None)
            self.db.execute("DELETE FROM kv WHERE key = ?", (f"joberr:{job_id}",))
            self.wake()
        elif action == "redownload" and status in FINAL:
            item = JobItem(url=row["url"], title=row["title"], channel=row["channel"],
                           thumbnail=row["thumbnail"], duration=row["duration"])
            opts = DownloadOptions.model_validate_json(row["options"])
            return self.create([item], [row["url"]], opts)[0]
        else:
            raise ValueError(f"can't {action} a {status} job")
        self._publish(job_id)
        return self.get(job_id)

    def remove(self, job_id: str) -> bool:
        row = self._row(job_id)
        if not row or row["status"] not in FINAL:
            return False
        self.db.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
        self.db.execute("DELETE FROM kv WHERE key = ?", (f"joberr:{job_id}",))
        self.bus.publish("job_removed", {"id": job_id})
        return True

    def clear_history(self) -> int:
        rows = self.db.all("SELECT id FROM jobs WHERE status IN ('completed', 'failed', 'canceled')")
        for r in rows:
            self.remove(r["id"])
        return len(rows)

    # -- scheduler ------------------------------------------------------
    async def _scheduler(self) -> None:
        while True:
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=5)
            except asyncio.TimeoutError:
                pass
            self._wake.clear()
            try:
                limit = self.settings.get()[0].defaults.concurrentDownloads
                free = limit - len(self.tasks)
                if free <= 0:
                    continue
                rows = self.db.all(
                    "SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at LIMIT ?", (free,))
                for r in rows:
                    self._launch(r["id"])
            except Exception:
                log.exception("scheduler error")

    def _launch(self, job_id: str) -> None:
        self._set(job_id, status="running", started_at=time.time(), error_code=None, error_msg=None)
        self.live[job_id] = Live(phase="starting", progress=None)
        self.tasks[job_id] = asyncio.create_task(self._run_guarded(job_id))
        self._publish(job_id)

    async def _run_guarded(self, job_id: str) -> None:
        try:
            await self._run(job_id)
        except Exception as exc:
            log.exception("job %s crashed", job_id)
            self._fail(job_id, FriendlyError("internal", "Something went wrong on the server.", str(exc)[:500]))
        finally:
            self.tasks.pop(job_id, None)
            self.live.pop(job_id, None)
            self.wake()

    def _fail(self, job_id: str, err: FriendlyError) -> None:
        self._set(job_id, status="failed", error_code=err.code, error_msg=err.message,
                  finished_at=time.time())
        self.db.set_json(f"joberr:{job_id}", err.detail, time.time())
        live = self.live.get(job_id)
        if live:
            live.phase = "failed"
        self._publish(job_id)

    def _handle_stop(self, job_id: str, live: Live) -> bool:
        reason = live.stop_reason
        if not reason:
            return False
        if reason == "cancel":
            shutil.rmtree(self.cfg.work_dir / job_id, ignore_errors=True)
            self._set(job_id, status="canceled", finished_at=time.time())
        elif reason == "pause":
            self._set(job_id, status="paused")
        else:  # shutdown: resume on next start
            self._set(job_id, status="queued")
        self.live.pop(job_id, None)
        self._publish(job_id)
        return True

    async def _run(self, job_id: str) -> None:
        row = self._row(job_id)
        live = self.live[job_id]
        if not row:
            return
        opts = DownloadOptions.model_validate_json(row["options"])
        work = (self.cfg.work_dir / job_id).resolve()
        work.mkdir(parents=True, exist_ok=True)
        if self._handle_stop(job_id, live):
            return

        # 1. download with yt-dlp
        proc = await asyncio.create_subprocess_exec(
            *ytdlp.download_args(self.cfg, opts, row["url"], work),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            env=ytdlp.child_env(self.cfg), cwd=str(work), start_new_session=True,
            limit=1024 * 1024,
        )
        live.procs = [proc]
        assert proc.stdout is not None and proc.stderr is not None
        stderr_task = asyncio.create_task(proc.stderr.read())
        done: dict[str, Any] | None = None
        sizes: list[int | None] = []
        format_ids: list[str] = []
        seen: list[str] = []
        live.phase, live.progress = "downloading", 0.0
        async for raw in proc.stdout:
            line = raw.decode("utf-8", "replace").rstrip("\n")
            if line.startswith(ytdlp.PROGRESS_PREFIX):
                self._on_progress(job_id, live, line[len(ytdlp.PROGRESS_PREFIX):], sizes, format_ids, seen)
            elif line.startswith(ytdlp.PRE_PREFIX):
                try:
                    pre = json.loads(line[len(ytdlp.PRE_PREFIX):])
                except json.JSONDecodeError:
                    continue
                reqs = pre.get("requested_formats") or []
                format_ids = [str(f.get("format_id")) for f in reqs] or [str(pre.get("format_id"))]
                sizes = ([f.get("filesize") or f.get("filesize_approx") for f in reqs]
                         or [pre.get("filesize") or pre.get("filesize_approx")])
                live.streams = len(format_ids)
            elif line.startswith(ytdlp.POST_PREFIX):
                live.phase, live.progress, live.speed, live.eta = "processing", None, None, None
                self._publish(job_id)
            elif line.startswith(ytdlp.DONE_PREFIX):
                try:
                    done = json.loads(line[len(ytdlp.DONE_PREFIX):])
                except json.JSONDecodeError:
                    pass
        code = await proc.wait()
        stderr = (await stderr_task).decode("utf-8", "replace")
        live.procs = []
        if self._handle_stop(job_id, live):
            return
        if code != 0 and not stderr.strip():
            stderr = f"ERROR: yt-dlp exited with code {code}"
        if code != 0 or not done or not done.get("filepath"):
            self._fail(job_id, friendly(stderr) if code != 0 else
                       FriendlyError("unknown", "yt-dlp finished without producing a file.",
                                     stderr[-500:]))
            return
        path = Path(done["filepath"]).resolve()
        if not path.is_relative_to(work) or not path.is_file():
            self._fail(job_id, FriendlyError("internal", "The downloaded file went missing."))
            return

        # 2. guarantee container compatibility (H.264/AAC MP4, VP9/Opus WebM)
        info = media.stream_info(await media.probe(path))
        if opts.kind == "video" and (opts.container == "webm" or opts.mp4Compat == "strict"):
            v, a = media.needs_transcode(opts.container, info)
            if v or a:
                live.phase, live.progress, live.speed, live.eta = "converting", 0.0, None, None
                self._publish(job_id)
                out = work / f"converted.{opts.container}"

                async def on_progress(frac: float) -> None:
                    live.progress = frac
                    self._publish(job_id, force=False)

                code, err = await media.run_ffmpeg(
                    media.transcode_args(path, out, opts.container, v, a), info.get("duration"),
                    on_progress, lambda p: live.procs.append(p))
                live.procs = []
                if self._handle_stop(job_id, live):
                    return
                if code != 0 or not out.is_file():
                    self._fail(job_id, FriendlyError("ffmpeg", "Converting the file failed.", err[-500:]))
                    return
                path.unlink(missing_ok=True)
                path = out.rename(work / f"media.{opts.container}")
                info = media.stream_info(await media.probe(path))

        # 3. tags and cover art
        live.phase, live.progress = "tagging", None
        self._publish(job_id)
        tags = opts.tags
        channel = done.get("channel") or done.get("uploader") or done.get("creator") or row["channel"]
        title = (tags.title if tags and tags.title else None) or done.get("title") or row["title"]
        artist = (tags.artist if tags and tags.artist else None) or done.get("artist") or channel
        album = (tags.album if tags and tags.album else None) or done.get("album") or done.get("playlist_title")
        thumb = work / "thumb.jpg"
        ext = path.suffix.lstrip(".").lower()
        cover = thumb if opts.embedCover and thumb.is_file() else None
        if opts.kind == "audio" or ext == "mp4":
            await asyncio.to_thread(media.write_tags, path, ext, title, artist, album, cover)

        # 4. into the library
        if opts.kind == "audio":
            quality = {"mp3": f"MP3 {opts.audioBitrate}k", "m4a": "M4A/AAC", "opus": "Opus",
                       "wav": "WAV"}[opts.audioFormat]
        else:
            quality = f"{info['height']}p" if info.get("height") else "video"
        upload_date = str(done.get("upload_date") or "")
        values = {
            "title": title, "channel": channel, "artist": artist, "album": album,
            "id": done.get("id"), "quality": quality, "format": ext,
            "site": done.get("extractor_key"),
            "date": (f"{upload_date[:4]}-{upload_date[4:6]}-{upload_date[6:8]}"
                     if len(upload_date) == 8 else None),
        }
        name = render(opts.filenameTemplate, values)
        file_row = await asyncio.to_thread(
            self.library.add, job_id=job_id, src=path, thumb=thumb if thumb.is_file() else None,
            name=name, kind=opts.kind, quality=quality,
            meta={**info, "title": title, "channel": channel,
                  "source_url": done.get("webpage_url") or row["url"]},
        )
        self._set(job_id, status="completed", file_id=file_row["id"], finished_at=time.time(),
                  title=title, channel=channel)
        shutil.rmtree(work, ignore_errors=True)
        self.live.pop(job_id, None)
        self._publish(job_id)
        self.bus.publish("library", {"added": file_row["id"]})
        storage = self.settings.get()[0].storage
        removed = await asyncio.to_thread(self.library.cleanup, storage)
        if removed:
            self.bus.publish("library", {"removed": removed})

    def _on_progress(self, job_id: str, live: Live, payload: str, sizes: list[int | None],
                     format_ids: list[str], seen: list[str]) -> None:
        try:
            prog_json, _, fmt_json = payload.rpartition(" ")
            prog = json.loads(prog_json)
            fmt = str(json.loads(fmt_json))
        except (json.JSONDecodeError, ValueError):
            return
        if fmt not in seen:
            seen.append(fmt)
        idx = format_ids.index(fmt) if fmt in format_ids else len(seen) - 1
        live.stream = idx
        live.streams = max(live.streams, len(format_ids), len(seen))
        downloaded = int(prog.get("downloaded_bytes") or 0)
        total = prog.get("total_bytes") or prog.get("total_bytes_estimate")
        live.downloaded, live.total = downloaded, int(total) if total else None
        live.speed, live.eta = prog.get("speed"), prog.get("eta")
        frac = (downloaded / total) if total else None
        if prog.get("status") == "finished":
            frac = 1.0
        if frac is not None:
            if sizes and all(sizes) and len(sizes) == live.streams:
                done_bytes = sum(sizes[:idx]) + frac * sizes[idx]  # type: ignore[operator]
                live.progress = min(1.0, done_bytes / sum(sizes))  # type: ignore[arg-type]
            else:
                live.progress = min(1.0, (idx + frac) / live.streams)
        live.phase = "downloading"
        self._publish(job_id, force=prog.get("status") == "finished")

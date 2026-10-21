"""DubDeck backend: FastAPI app wiring, middleware, and routes."""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Literal

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import ytdlp
from .allowlist import Allowlist
from .auth import Auth, User, api_error
from .config import Config, load_config
from .db import Database
from .events import EventBus
from .jobs import JobManager
from .library import CONTENT_TYPES, Library
from .models import (BulkDelete, CreateJobs, DevLogin, GoogleLogin, LinkRequest, Logout,
                     PreviewRequest, Rename, SettingsUpdate)
from .ratelimit import LIMITS, RateLimiter
from .settings_store import SettingsConflict, SettingsStore
from .signing import SignatureError, Signer
from .urls import UrlError, validate_url

log = logging.getLogger("dubdeck")
MAX_BODY = 1024 * 1024
SSE_HEARTBEAT = 15


class Services:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.db = Database(cfg.db_path)
        self.allowlist = Allowlist(cfg.allowlist_path, cfg.allowlist_url, cfg.allowlist_token,
                                   cfg.extra_allowed_emails)
        self.auth = Auth(cfg, self.db, self.allowlist)
        self.signer = Signer(cfg.signing_secret, cfg.signed_url_ttl)
        self.bus = EventBus()
        self.settings = SettingsStore(self.db)
        self.library = Library(cfg, self.db, self.signer)
        self.jobs = JobManager(cfg, self.db, self.bus, self.library, self.settings)
        self.limiter = RateLimiter()


async def _cleanup_loop(s: Services) -> None:
    while True:
        await asyncio.sleep(3600)
        try:
            removed = await asyncio.to_thread(s.library.cleanup, s.settings.get()[0].storage)
            if removed:
                s.bus.publish("library", {"removed": removed})
        except Exception:
            log.exception("cleanup failed")


def create_app(cfg: Config | None = None) -> FastAPI:
    cfg = cfg or load_config()
    s = Services(cfg)
    if cfg.dev_login:
        log.warning("DUBDECK_DEV_LOGIN is ON: anyone with the backend key can sign in "
                    "as an allowlisted email without Google. Never enable this in production.")
    if not s.allowlist.policy().emails and not s.allowlist.policy().domains:
        log.warning("The allowlist is empty: nobody can sign in. Check DUBDECK_ALLOWLIST_PATH.")

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await s.jobs.start()
        cleanup = asyncio.create_task(_cleanup_loop(s))
        yield
        cleanup.cancel()
        await s.jobs.stop()
        s.db.close()

    app = FastAPI(title="DubDeck", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.services = s

    # -- error shape ----------------------------------------------------
    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, dict) else {"code": "error", "message": str(exc.detail)}
        return JSONResponse({"error": detail}, status_code=exc.status_code, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(p) for p in first.get("loc", [])[1:])
        msg = str(first.get("msg", "Invalid request")).removeprefix("Value error, ")
        return JSONResponse({"error": {"code": "invalid_request",
                                       "message": f"{where}: {msg}" if where else msg}}, status_code=422)

    # -- middleware: key gate, body cap, rate limits, headers ------------
    def client_ip(request: Request) -> str:
        if cfg.trust_cf_headers:
            for h in ("cf-connecting-ip", "fly-client-ip"):
                if request.headers.get(h):
                    return request.headers[h]
        return request.client.host if request.client else "unknown"

    def route_group(path: str, method: str) -> str:
        if path.startswith("/f/"):
            return "file"
        if path.startswith("/api/auth/") and method == "POST":
            return "auth"
        if path == "/api/preview":
            return "preview"
        if path == "/api/jobs" and method == "POST":
            return "jobs_create"
        if path.startswith("/api/system/update"):
            return "system"
        return "api"

    @app.middleware("http")
    async def gatekeeper(request: Request, call_next: Any) -> Any:
        path = request.url.path
        while "//" in path:  # tolerate proxies that join paths with a double slash
            path = path.replace("//", "/")
            request.scope["path"] = path
        is_api = path.startswith("/api/")
        if is_api:
            try:
                s.auth.check_key(request)
            except StarletteHTTPException as exc:
                wait = s.limiter.hit(f"unauth:{client_ip(request)}", *LIMITS["unauth"])
                status = 429 if wait else exc.status_code
                return JSONResponse({"error": exc.detail}, status_code=status)
            length = request.headers.get("content-length")
            if length and length.isdigit() and int(length) > MAX_BODY:
                return JSONResponse({"error": {"code": "too_large", "message": "Request too large."}},
                                    status_code=413)
        if is_api or path.startswith("/f/"):
            group = route_group(path, request.method)
            ident = s.auth.session_token(request)[:16] or client_ip(request)
            wait = s.limiter.hit(f"{group}:{ident}", *LIMITS[group])
            if wait is not None:
                return JSONResponse(
                    {"error": {"code": "rate_limited",
                               "message": "Too many requests. Slow down for a moment."}},
                    status_code=429, headers={"Retry-After": str(int(wait) + 1)})
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        if is_api:
            response.headers.setdefault("Cache-Control", "no-store")
            response.headers["X-Frame-Options"] = "DENY"
        return response

    def user(request: Request) -> User:
        return s.auth.current_user(request)

    def clean_url(raw: str) -> str:
        try:
            return validate_url(raw, allow_private=cfg.allow_private_urls)
        except UrlError as exc:
            raise api_error(400, exc.code, exc.message) from exc

    # -- health ---------------------------------------------------------
    @app.get("/healthz")
    async def healthz() -> dict[str, bool]:
        return {"ok": True}

    # -- auth -----------------------------------------------------------
    @app.get("/api/auth/config")
    async def auth_config() -> dict[str, Any]:
        return {"googleClientId": cfg.google_client_id or None, "devLogin": cfg.dev_login}

    def session_response(email: str, name: str | None, picture: str | None, request: Request) -> dict[str, Any]:
        if not s.allowlist.allows(email):
            log.warning("sign-in refused for %s (not on the allowlist)", email)
            raise api_error(403, "not_allowed", f"{email} isn't allowed to use DubDeck.")
        token, expires = s.auth.create_session(email, name, picture, request.headers.get("user-agent"))
        return {"token": token, "expiresAt": expires,
                "user": {"email": email, "name": name, "picture": picture}}

    @app.post("/api/auth/google")
    async def auth_google(body: GoogleLogin, request: Request) -> dict[str, Any]:
        email, name, picture = await asyncio.to_thread(s.auth.verify_google, body.credential)
        return session_response(email, name, picture, request)

    @app.post("/api/auth/dev")
    async def auth_dev(body: DevLogin, request: Request) -> dict[str, Any]:
        if not cfg.dev_login:
            raise api_error(404, "not_found", "Not found.")
        return session_response(body.email.strip().lower(), None, None, request)

    @app.get("/api/auth/me")
    async def auth_me(u: User = Depends(user)) -> dict[str, Any]:
        return {"email": u.email, "name": u.name, "picture": u.picture}

    @app.post("/api/auth/logout")
    async def auth_logout(body: Logout, u: User = Depends(user)) -> dict[str, bool]:
        s.auth.end_session(u, everywhere=body.everywhere)
        return {"ok": True}

    # -- preview --------------------------------------------------------
    @app.post("/api/preview")
    async def preview(body: PreviewRequest, _: User = Depends(user)) -> dict[str, Any]:
        url = clean_url(body.url)
        try:
            info = await ytdlp.preview(cfg, url)
        except ytdlp.YtdlpError as exc:
            raise api_error(422, exc.err.code, exc.err.message) from exc
        if info.get("type") == "playlist":
            good = []
            for e in info["entries"]:
                try:
                    e["url"] = validate_url(e["url"], allow_private=cfg.allow_private_urls, resolve=False)
                    good.append(e)
                except UrlError:
                    continue
            info["entries"] = good
        info["requestedUrl"] = url
        return info

    # -- jobs -----------------------------------------------------------
    @app.get("/api/jobs")
    async def list_jobs(limit: int = 300, _: User = Depends(user)) -> dict[str, Any]:
        return {"jobs": s.jobs.list(max(1, min(limit, 1000)))}

    @app.post("/api/jobs")
    async def create_jobs(body: CreateJobs, _: User = Depends(user)) -> dict[str, Any]:
        urls = [clean_url(item.url) for item in body.items]
        return {"jobs": s.jobs.create(body.items, urls, body.options)}

    @app.post("/api/jobs/clear")
    async def clear_jobs(_: User = Depends(user)) -> dict[str, int]:
        return {"removed": s.jobs.clear_history()}

    @app.post("/api/jobs/{job_id}/{action}")
    async def job_action(job_id: str,
                         action: Literal["pause", "resume", "cancel", "retry", "redownload"],
                         _: User = Depends(user)) -> dict[str, Any]:
        try:
            job = s.jobs.action(job_id, action)
        except ValueError as exc:
            raise api_error(409, "bad_state", str(exc)) from exc
        if not job:
            raise api_error(404, "not_found", "That job doesn't exist.")
        return {"job": job}

    @app.delete("/api/jobs/{job_id}")
    async def delete_job(job_id: str, _: User = Depends(user)) -> dict[str, bool]:
        if not s.jobs.remove(job_id):
            raise api_error(409, "bad_state", "Only finished jobs can be removed from history.")
        return {"ok": True}

    # -- events (SSE) ---------------------------------------------------
    @app.get("/api/events")
    async def events(request: Request, _: User = Depends(user)) -> StreamingResponse:
        q = s.bus.subscribe()

        async def stream() -> AsyncIterator[str]:
            try:
                yield "retry: 3000\n\n"
                yield EventBus.format("hello", {"time": time.time(),
                                                "jobs": s.jobs.list(300),
                                                "settingsUpdatedAt": s.settings.get()[1]})
                while s.bus.is_subscribed(q):
                    if await request.is_disconnected():
                        break
                    try:
                        yield await asyncio.wait_for(q.get(), timeout=SSE_HEARTBEAT)
                    except asyncio.TimeoutError:
                        yield ": ping\n\n"
            finally:
                s.bus.unsubscribe(q)

        return StreamingResponse(stream(), media_type="text/event-stream", headers={
            "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive",
        })

    # -- library --------------------------------------------------------
    @app.get("/api/library")
    async def library_list(_: User = Depends(user)) -> dict[str, Any]:
        return {"files": s.library.list()}

    @app.get("/api/library/stats")
    async def library_stats(_: User = Depends(user)) -> dict[str, Any]:
        return s.library.stats(s.settings.get()[0].storage)

    @app.post("/api/library/delete")
    async def library_bulk_delete(body: BulkDelete, _: User = Depends(user)) -> dict[str, int]:
        n = await asyncio.to_thread(s.library.delete, body.ids)
        s.bus.publish("library", {"removed": body.ids})
        return {"deleted": n}

    @app.post("/api/library/cleanup")
    async def library_cleanup(_: User = Depends(user)) -> dict[str, Any]:
        removed = await asyncio.to_thread(s.library.cleanup, s.settings.get()[0].storage, True)
        if removed:
            s.bus.publish("library", {"removed": removed})
        return {"deleted": len(removed)}

    @app.post("/api/library/{file_id}/link")
    async def library_link(file_id: str, body: LinkRequest, _: User = Depends(user)) -> dict[str, Any]:
        link = s.library.link(file_id, body.disposition)
        if not link:
            raise api_error(404, "not_found", "That file doesn't exist.")
        return link

    @app.patch("/api/library/{file_id}")
    async def library_rename(file_id: str, body: Rename, _: User = Depends(user)) -> dict[str, Any]:
        f = s.library.rename(file_id, body.name)
        if not f:
            raise api_error(404, "not_found", "That file doesn't exist.")
        s.bus.publish("library", {"updated": file_id})
        return {"file": f}

    @app.delete("/api/library/{file_id}")
    async def library_delete(file_id: str, _: User = Depends(user)) -> dict[str, int]:
        n = await asyncio.to_thread(s.library.delete, [file_id])
        if not n:
            raise api_error(404, "not_found", "That file doesn't exist.")
        s.bus.publish("library", {"removed": [file_id]})
        return {"deleted": n}

    # -- settings -------------------------------------------------------
    @app.get("/api/settings")
    async def get_settings(_: User = Depends(user)) -> dict[str, Any]:
        settings, updated_at = s.settings.get()
        return {"settings": settings.model_dump(mode="json"), "updatedAt": updated_at}

    @app.put("/api/settings")
    async def put_settings(body: SettingsUpdate, _: User = Depends(user)) -> Any:
        try:
            updated_at = s.settings.put(body.settings, body.baseUpdatedAt)
        except SettingsConflict as exc:
            return JSONResponse({"error": {"code": "conflict", "message": "Settings changed on another device."},
                                 "settings": exc.current.model_dump(mode="json"),
                                 "updatedAt": exc.updated_at}, status_code=409)
        s.bus.publish("settings", {"updatedAt": updated_at})
        s.jobs.wake()  # concurrency limit may have changed
        return {"settings": body.settings.model_dump(mode="json"), "updatedAt": updated_at}

    # -- system ---------------------------------------------------------
    @app.get("/api/system")
    async def system(_: User = Depends(user)) -> dict[str, Any]:
        return {"ytdlpVersion": await ytdlp.version(cfg), "cookies": bool(cfg.cookies_file),
                "signedUrlTtl": cfg.signed_url_ttl, "publicUrl": cfg.public_url}

    @app.post("/api/system/update-ytdlp")
    async def update_ytdlp(_: User = Depends(user)) -> dict[str, Any]:
        ok, output = await ytdlp.update(cfg)
        return {"ok": ok, "version": await ytdlp.version(cfg), "output": output}

    # -- signed file downloads (direct from the tunnel, not the proxy) ---
    @app.get("/f/{token}")
    @app.head("/f/{token}")
    async def signed_file(token: str) -> FileResponse:
        try:
            grant = s.signer.verify(token)
        except SignatureError as exc:
            raise api_error(403, "link_expired", "This download link is invalid or has expired.") from exc
        row = s.library.get(grant.file_id)
        if not row:
            raise api_error(404, "not_found", "That file no longer exists.")
        if grant.kind == "thumb":
            path = s.library.thumb_path(row["id"])
            media_type, filename = "image/jpeg", f"{row['name']}.jpg"
        else:
            path = s.library.media_path(row)
            media_type, filename = CONTENT_TYPES.get(row["ext"], "application/octet-stream"), \
                f"{row['name']}.{row['ext']}"
        if not path.is_file():
            raise api_error(404, "not_found", "That file no longer exists.")
        resp = FileResponse(path, media_type=media_type, filename=filename,
                            content_disposition_type=grant.disposition)
        resp.headers["Cache-Control"] = f"private, max-age={max(0, grant.expires_at - int(time.time()))}"
        resp.headers["Cross-Origin-Resource-Policy"] = "cross-origin"
        resp.headers["Content-Security-Policy"] = "default-src 'none'; sandbox"
        return resp

    return app

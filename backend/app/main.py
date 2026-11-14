"""The FastAPI app: routers under /api, CORS, the error shape, start-up."""

import asyncio
import logging
import mimetypes
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import select
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import get_settings
from app.db import init_db, new_session
from app.models import Call
from app.routers import accounts, billing, calls, dev, families, phone, push, scenarios, streams, voice, voice_sample, waitlist, weekly
from app.schemas import ApiError
from app.services import scheduler

log = logging.getLogger("app")

STATUS_CODES = {
    400: "bad_request",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "too_large",
    415: "unsupported_media_type",
    429: "too_many_requests",
    422: "invalid_request",
    502: "upstream_failed",
}


async def _run_scheduler() -> None:
    """Run track B's loop; a crash or a stub is logged and never stops the app."""
    try:
        await scheduler.run_forever()
    except asyncio.CancelledError:
        raise
    except NotImplementedError:
        log.warning("scheduler.run_forever is not implemented yet; no scheduler running")
    except Exception:
        log.exception("scheduler loop crashed; the app keeps running without it")


def resume_after_call_work() -> None:
    """Start the after-call work again for every call a restart left
    'ended' (that work runs only in memory). after_call re-checks the
    status, so a call scored meanwhile is left alone."""
    with new_session() as db:
        call_ids = list(db.scalars(select(Call.id).where(Call.status == "ended")))
    for call_id in call_ids:
        log.info("resuming the after-call work for %s", call_id)
        calls.start_after_call(call_id)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    init_db()
    try:
        resume_after_call_work()
    except Exception:
        log.exception("could not resume the after-call work of ended calls")
    task: asyncio.Task | None = None
    if get_settings().scheduler_enabled:
        task = asyncio.create_task(_run_scheduler(), name="scheduler")
    try:
        yield
    finally:
        if task is not None:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass


def error_body(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}


def create_app() -> FastAPI:
    app = FastAPI(title="Callback", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(ApiError)
    async def api_error_handler(_request: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=error_body(exc.code, exc.message))

    @app.exception_handler(StarletteHTTPException)
    async def http_error_handler(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = STATUS_CODES.get(exc.status_code, "error")
        return JSONResponse(status_code=exc.status_code, content=error_body(code, str(exc.detail)),
                            headers=getattr(exc, "headers", None))

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(part) for part in first.get("loc", ()))
        message = f"{where}: {first.get('msg', 'invalid request')}" if where else "Invalid request."
        return JSONResponse(status_code=422, content=error_body("invalid_request", message))

    @app.exception_handler(Exception)
    async def unexpected_error_handler(_request: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled error", exc_info=exc)
        return JSONResponse(status_code=500, content=error_body("internal_error", "Something went wrong."))

    for module in (families, voice, phone, push, scenarios, calls, streams, weekly, dev, billing, waitlist, accounts, voice_sample):
        app.include_router(module.router, prefix="/api")
    mount_frontend(app)
    return app


mimetypes.add_type("application/manifest+json", ".webmanifest")


def mount_frontend(app: FastAPI) -> None:
    """Serve the built front end (settings.frontend_dist) at /, for a server
    where the back end runs alone. Files that exist are served as they are
    (hashed assets cached for a year); every other path gets index.html, so
    the app's own routes (/phone/..., /family/...) work on reload. /api paths
    never fall through to the front end."""
    raw = get_settings().frontend_dist
    if not raw:
        return
    dist = Path(raw).expanduser().resolve()
    index = dist / "index.html"
    if not index.is_file():
        log.warning("FRONTEND_DIST %s has no index.html; not serving the front end", dist)
        return

    @app.get("/{full_path:path}", include_in_schema=False)
    async def frontend(full_path: str) -> FileResponse:
        if full_path == "api" or full_path.startswith("api/"):
            raise StarletteHTTPException(404, "Not Found")
        if full_path:
            candidate = (dist / full_path).resolve()
            if candidate.is_file() and candidate.is_relative_to(dist):
                cache = "public, max-age=31536000, immutable" if full_path.startswith("assets/") else "no-cache"
                return FileResponse(candidate, headers={"Cache-Control": cache})
        return FileResponse(index, headers={"Cache-Control": "no-cache"})


app = create_app()

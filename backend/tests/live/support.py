"""Helpers for the live tests (see conftest.py here). Never print a key or a
token: only say whether it is set."""

import contextlib
import shutil
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest

from app import db as app_db
from app.agents import llm
from app.config import get_settings

ELEVENLABS = "https://api.elevenlabs.io"

# Lines for the "live report" section at the end of the run.
REPORT: list[str] = []


def _fresh() -> None:
    get_settings.cache_clear()
    llm._clients.clear()  # the SDK clients belong to the event loop that made them
    app_db.reset_engine()


@contextlib.contextmanager
def storage(folder: Path, **env: str) -> Iterator[None]:
    """A temporary database and media folder under `folder`, the scheduler
    off and FAKE_ELEVENLABS off, plus any `env` overrides. The keys and ids
    stay as backend/.env has them."""
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("DATABASE_URL", f"sqlite:///{folder / 'live.db'}")
        patch.setenv("MEDIA_DIR", str(folder / "media"))
        patch.setenv("SCHEDULER_ENABLED", "false")
        patch.setenv("FAKE_ELEVENLABS", "false")
        for name, value in env.items():
            patch.setenv(name, value)
        _fresh()
        app_db.init_db()
        try:
            yield
        finally:
            _fresh()


# ---------------------------------------------------------------- skipping


def need(*names: str) -> None:
    """Skip the test unless every setting is set (names as in .env)."""
    settings = get_settings()
    missing = [name for name in names if not getattr(settings, name.lower())]
    if missing:
        pytest.skip(f"{', '.join(missing)} not set in backend/.env")


def need_job(job: str) -> None:
    """Skip unless at least one of the job's models has its provider's key."""
    models = llm.job_models(job)
    if not any(llm._api_key(llm.provider_of(model)) for model in models):
        pytest.skip(f"no API key for any {job} model ({', '.join(models)}): "
                    "set OPENAI_API_KEY or ANTHROPIC_API_KEY in backend/.env")


def need_tool(name: str) -> None:
    if shutil.which(name) is None:
        pytest.skip(f"{name} is not installed")


# ---------------------------------------------------------------- ElevenLabs


def xi_get(path: str) -> httpx.Response:
    """GET an ElevenLabs path with the key from backend/.env."""
    return httpx.get(ELEVENLABS + path, headers={"xi-api-key": get_settings().elevenlabs_api_key}, timeout=20)

"""The news rebuilds itself when stale (services/news.keep_fresh_forever)."""

import asyncio
from datetime import timedelta

from app.db import new_session, to_iso, utcnow
from app.models import Digest
from app.routers import weekly
from app.services import news


def store(created_minutes_ago: float, real: bool = True) -> None:
    sources = ["https://consumer.ftc.gov/consumer-alerts"] if real else [weekly.FALLBACK_SOURCE]
    weekly._save_digest(weekly.iso_week(), sources, [{"title": "Bank safe-account calls", "summary": "x", "tactics": ["urgency"]}])
    with new_session() as db:
        row = db.query(Digest).one()
        row.created_at = to_iso(utcnow() - timedelta(minutes=created_minutes_ago))
        db.commit()


def test_needs_rebuild(client) -> None:
    assert news.needs_rebuild(3600) is True  # nothing stored
    store(10)
    assert news.needs_rebuild(3600) is False
    store(61)
    assert news.needs_rebuild(3600) is True
    store(1, real=False)  # only the built-in examples
    assert news.needs_rebuild(3600) is True


def test_the_loop_builds_once_when_stale_and_never_raises(client, monkeypatch) -> None:
    calls = []

    async def fake_build() -> str:
        calls.append(1)
        return "refreshed"

    async def no_sleep(seconds):
        if len(sleeps) > 2:
            raise asyncio.CancelledError
        sleeps.append(seconds)

    sleeps: list[float] = []
    monkeypatch.setattr(news, "build_and_store", fake_build)
    monkeypatch.setattr(news.asyncio, "sleep", no_sleep)
    try:
        asyncio.run(news.keep_fresh_forever())
    except asyncio.CancelledError:
        pass
    assert calls  # nothing was stored, so it built

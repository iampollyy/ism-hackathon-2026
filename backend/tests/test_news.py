"""Track 4: the news screen and its refresh (services/news.py). The model
jobs are replaced and Firecrawl has no key (its built-in pages), so nothing
reaches the network."""

import asyncio
import json
from datetime import timedelta
from typing import Any

import pytest
from pydantic import BaseModel
from sqlalchemy import func, select

from app.agents import llm
from app.db import new_session, now_iso, parse_time, to_iso, utcnow
from app.models import Call, Digest, Family, Member, Message, ModelRun, NewsRefresh
from app.routers import weekly
from app.services import firecrawl, news

DIGEST = {"patterns": [
    {"title": "Parcel fee calls", "summary": "A caller asks for a small fee to release a parcel.",
     "tactics": ["small_ask_first", "urgency"], "closest_scenario": "bank_security",
     "source_url": "https://consumer.ftc.gov/consumer-alerts"},
    {"title": "A relative with a new number", "summary": "Someone sounding like family needs money today.",
     "tactics": ["new_number"], "closest_scenario": "relative_new_number",
     "source_url": "builtin:relative-new-number"},
]}


class FakeRunJob:
    def __init__(self) -> None:
        self.outputs: dict[str, Any] = {}
        self.jobs: list[str] = []

    async def __call__(self, job: str, *, system: str, user: str, schema: type[BaseModel],
                       prompt_version: str, max_tokens: int = 8000) -> BaseModel | None:
        self.jobs.append(job)
        output = self.outputs.get(job)
        return schema.model_validate(output) if isinstance(output, dict) else None


@pytest.fixture
def jobs(monkeypatch: pytest.MonkeyPatch) -> FakeRunJob:
    fake = FakeRunJob()
    fake.outputs["digest"] = DIGEST
    monkeypatch.setattr(llm, "run_job", fake)
    return fake


@pytest.fixture
def fam(make_family: Any) -> dict[str, str]:
    body = make_family(3)
    ids = [member["id"] for member in body["members"]]
    return {"id": body["family_id"], "sara": ids[0], "jon": ids[1], "ana": ids[2]}


def count(model: type) -> int:
    with new_session() as db:
        return int(db.scalar(select(func.count()).select_from(model)) or 0)


def backdate(seconds: float) -> None:
    """Move every refresh and digest that many seconds into the past."""
    with new_session() as db:
        for row in [*db.scalars(select(NewsRefresh)), *db.scalars(select(Digest))]:
            row.created_at = to_iso(parse_time(row.created_at) - timedelta(seconds=seconds))
        db.commit()


# ---------------------------------------------------------------- reading


def test_news_unknown_family(client: Any) -> None:
    for response in (client.get("/api/families/fam_nope/news"), client.post("/api/families/fam_nope/news/refresh")):
        assert response.status_code == 404 and response.json()["error"]["code"] == "not_found"


def test_news_without_a_digest(client: Any, fam: dict[str, str]) -> None:
    assert client.get(f"/api/families/{fam['id']}/news").json() == {
        "patterns": [], "updated_at": None, "week": None, "fallback": False, "notes": [], "next_refresh_at": None}


def test_news_from_the_latest_digest_and_weekly_notes(client: Any, fam: dict[str, str]) -> None:
    patterns = [
        {**DIGEST["patterns"][0], "tactics": ["small_ask_first", "urgency", "urgency", "made_up"]},
        DIGEST["patterns"][1],
        {"title": "", "summary": "No title, so it is left out.", "tactics": [], "source_url": ""},
    ]
    with new_session() as db:
        db.add(Digest(week="2026-W45", sources_json='["https://old.example"]', tactics_json=json.dumps([
            {"title": "Old", "summary": "Last week.", "tactics": [], "source_url": "https://old.example"}]),
            created_at="2026-11-07T09:00:00+00:00"))
        db.add(Digest(week=weekly.iso_week(), sources_json='["https://consumer.ftc.gov/consumer-alerts"]',
                      tactics_json=json.dumps(patterns), created_at="2026-11-09T09:30:00+00:00"))
        db.add(Message(member_id=fam["sara"], kind="weekly", text="Older note.", created_at="2026-11-07T10:00:00+00:00"))
        db.add(Message(member_id=fam["sara"], kind="weekly", text="Newest note.", created_at="2026-11-14T10:00:00+00:00"))
        db.add(Message(member_id=fam["sara"], kind="reminder", text="Not a note.", created_at="2026-11-14T11:00:00+00:00"))
        db.add(Message(member_id=fam["ana"], kind="weekly", text="Ana left.", created_at="2026-11-14T10:00:00+00:00"))
        db.get(Member, fam["ana"]).opted_out_at = now_iso()
        db.commit()

    body = client.get(f"/api/families/{fam['id']}/news").json()
    assert body["updated_at"] == "2026-11-09T09:30:00+00:00" and body["week"] == weekly.iso_week()
    assert body["fallback"] is False and body["next_refresh_at"] is None
    assert body["patterns"] == [
        {"title": "Parcel fee calls", "summary": "A caller asks for a small fee to release a parcel.",
         "tactics": [{"key": "small_ask_first", "label": "Small ask first"}, {"key": "urgency", "label": "Urgency"}],
         "closest_scenario": "bank_security",
         "sources": [{"url": "https://consumer.ftc.gov/consumer-alerts", "date": "2026-11-09"}]},
        {"title": "A relative with a new number", "summary": "Someone sounding like family needs money today.",
         "tactics": [{"key": "new_number", "label": "New number"}], "closest_scenario": "relative_new_number",
         "sources": []},  # a built-in example has no web address
    ]
    assert body["notes"] == [{"member": {"id": fam["sara"], "name": "Sara"}, "text": "Newest note.",
                              "when": "2026-11-14T10:00:00+00:00"}]


def test_a_fallback_row_is_marked_and_has_no_source_dates(client: Any, fam: dict[str, str]) -> None:
    """The weekly run carried last week's patterns forward: when their pages
    were read is not known, so no date (the row's own time is later)."""
    with new_session() as db:
        db.add(Digest(week=weekly.iso_week(), sources_json=json.dumps([weekly.FALLBACK_SOURCE]),
                      tactics_json=json.dumps(DIGEST["patterns"]), created_at="2026-11-09T09:30:00+00:00"))
        db.commit()
    body = client.get(f"/api/families/{fam['id']}/news").json()
    assert body["fallback"] is True and body["week"] == weekly.iso_week()
    assert body["patterns"][0]["sources"] == [{"url": "https://consumer.ftc.gov/consumer-alerts", "date": None}]


# ---------------------------------------------------------------- refreshing


def test_refresh_builds_a_digest_and_nothing_else(client: Any, fam: dict[str, str], jobs: FakeRunJob) -> None:
    body = client.post(f"/api/families/{fam['id']}/news/refresh").json()
    assert body["refreshed"] is True and body["reason"] is None
    assert [pattern["title"] for pattern in body["patterns"]] == ["Parcel fee calls", "A relative with a new number"]
    assert body["week"] == weekly.iso_week() and body["fallback"] is False
    ready = parse_time(body["next_refresh_at"]) - utcnow()
    assert timedelta(minutes=9) < ready <= timedelta(minutes=10)
    assert jobs.jobs == ["digest"]
    assert count(Call) == 0 and count(Message) == 0  # never a call or a message
    with new_session() as db:
        digest = db.scalars(select(Digest)).one()
        assert digest.week == weekly.iso_week()
        assert json.loads(digest.sources_json) == [page["url"] for page in firecrawl.BUILTIN_PAGES]
        assert db.scalars(select(NewsRefresh)).one().outcome == "refreshed"
    assert client.get(f"/api/families/{fam['id']}/news").json()["patterns"] == body["patterns"]


def test_refresh_at_most_every_ten_minutes(client: Any, fam: dict[str, str], jobs: FakeRunJob) -> None:
    url = f"/api/families/{fam['id']}/news/refresh"
    first = client.post(url).json()
    again = client.post(url).json()
    assert again["refreshed"] is False and again["reason"] == "too_soon"
    assert again["patterns"] == first["patterns"] and again["next_refresh_at"] == first["next_refresh_at"]
    assert jobs.jobs == ["digest"] and count(NewsRefresh) == 1

    backdate(11 * 60)
    jobs.outputs["digest"] = {"patterns": [{**DIGEST["patterns"][0], "title": "Newer pattern"}]}
    later = client.post(url).json()
    assert later["refreshed"] is True and [p["title"] for p in later["patterns"]] == ["Newer pattern"]
    assert jobs.jobs == ["digest", "digest"] and count(Digest) == 1  # this week's row, replaced


def test_a_fresh_digest_is_shared(client: Any, fam: dict[str, str], make_family: Any, jobs: FakeRunJob) -> None:
    client.post(f"/api/families/{fam['id']}/news/refresh")
    other = make_family(1)["family_id"]
    body = client.post(f"/api/families/{other}/news/refresh").json()
    assert body["refreshed"] is False and body["reason"] == "fresh"
    assert len(body["patterns"]) == 2
    # A click before then would not build either: the button stays off for everyone.
    assert body["next_refresh_at"] == client.get(f"/api/families/{fam['id']}/news").json()["next_refresh_at"]
    assert body["next_refresh_at"] is not None
    assert jobs.jobs == ["digest"]


def test_refresh_without_a_model_stores_the_built_in_examples(client: Any, fam: dict[str, str],
                                                              make_family: Any) -> None:
    body = client.post(f"/api/families/{fam['id']}/news/refresh").json()
    assert body["refreshed"] is False and body["reason"] == "no_new_digest"
    assert body["fallback"] is True
    assert [p["title"] for p in body["patterns"]] == [p["title"] for p in weekly.FALLBACK_PATTERNS]
    assert all(pattern["sources"] == [] for pattern in body["patterns"])
    assert count(ModelRun) == 0 and count(Digest) == 1
    # Another family within ten minutes: no second build (the news is shared).
    other_id = make_family(1)["family_id"]
    other = client.post(f"/api/families/{other_id}/news/refresh").json()
    assert other["reason"] == "too_soon" and other["patterns"] == body["patterns"]
    assert other["next_refresh_at"] == body["next_refresh_at"] and count(NewsRefresh) == 1
    # Later: it builds, still gets no model, and the stored examples stay as they are.
    backdate(11 * 60)
    later = client.post(f"/api/families/{other_id}/news/refresh").json()
    assert later["reason"] == "no_new_digest" and later["patterns"] == body["patterns"]
    assert count(Digest) == 1 and count(NewsRefresh) == 2


def test_refresh_keeps_an_older_digest_when_no_model_answers(client: Any, fam: dict[str, str]) -> None:
    with new_session() as db:
        db.add(Digest(week="2026-W40", sources_json='["https://consumer.ftc.gov/consumer-alerts"]',
                      tactics_json=json.dumps(DIGEST["patterns"][:1]), created_at="2026-10-01T09:00:00+00:00"))
        db.commit()
    body = client.post(f"/api/families/{fam['id']}/news/refresh").json()
    assert body["reason"] == "no_new_digest" and body["week"] == "2026-W40"
    assert [p["title"] for p in body["patterns"]] == ["Parcel fee calls"] and count(Digest) == 1
    # Weeks old: not this week's news, though a model built it (on the day it read the page).
    assert body["fallback"] is True
    assert body["patterns"][0]["sources"] == [{"url": "https://consumer.ftc.gov/consumer-alerts", "date": "2026-10-01"}]


def test_refresh_never_raises(client: Any, fam: dict[str, str], monkeypatch: pytest.MonkeyPatch) -> None:
    async def broken(urls: list[str]) -> list[dict[str, Any]]:
        raise RuntimeError("network down")

    monkeypatch.setattr(firecrawl, "fetch_warnings", broken)
    response = client.post(f"/api/families/{fam['id']}/news/refresh")
    assert response.status_code == 200
    body = response.json()
    assert body["refreshed"] is False and body["reason"] == "failed" and body["patterns"] == []
    with new_session() as db:
        assert db.scalars(select(NewsRefresh)).one().outcome == "failed"


def test_refresh_reads_the_weekly_run_pages(client: Any, fam: dict[str, str], jobs: FakeRunJob,
                                            monkeypatch: pytest.MonkeyPatch) -> None:
    asked: list[list[str]] = []

    async def pages(urls: list[str]) -> list[dict[str, Any]]:
        asked.append(urls)
        return [{"url": "https://consumer.ftc.gov/consumer-alerts", "title": "Alerts", "text": "Some warnings."}]

    monkeypatch.setattr(firecrawl, "fetch_warnings", pages)
    assert client.post(f"/api/families/{fam['id']}/news/refresh").json()["refreshed"] is True
    assert asked == [weekly.WARNING_URLS]
    # The weekly run then uses this week's digest as it is, without the job again.
    run = client.post(f"/api/families/{fam['id']}/weekly-run").json()
    assert [p["title"] for p in run["digest"]["patterns"]] == ["Parcel fee calls", "A relative with a new number"]
    assert jobs.jobs.count("digest") == 1


# ---------------------------------------------------------------- refreshes at the same time


@pytest.fixture
def slow_pages(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Firecrawl that takes a moment and, while it waits, writes in another
    session: that write fails ("database is locked") if a refresh held an
    uncommitted write across the await."""
    written: list[str] = []

    async def pages(urls: list[str]) -> list[dict[str, Any]]:
        await asyncio.sleep(0.05)
        with new_session() as other:
            other.add(Digest(week="2001-W01", sources_json="[]", tactics_json="[]",
                             created_at="2001-01-01T00:00:00+00:00"))
            other.commit()
        written.append("digest")
        return firecrawl.builtin_pages()

    monkeypatch.setattr(firecrawl, "fetch_warnings", pages)
    return written


async def refresh_at_once(*family_ids: str) -> list[Any]:
    sessions = [new_session() for _ in family_ids]
    try:
        families = [db.get(Family, family_id) for db, family_id in zip(sessions, family_ids)]
        return list(await asyncio.gather(*(news.refresh(db, family) for db, family in zip(sessions, families))))
    finally:
        for db in sessions:
            db.close()


async def test_two_clicks_at_once_build_once(fam: dict[str, str], jobs: FakeRunJob, slow_pages: list[str]) -> None:
    first, second = await refresh_at_once(fam["id"], fam["id"])
    assert (first.refreshed, first.reason) == (True, None)
    assert (second.refreshed, second.reason) == (False, "too_soon")
    assert jobs.jobs == ["digest"] and slow_pages == ["digest"]  # one build; the other write went through
    with new_session() as db:
        assert [row.outcome for row in db.scalars(select(NewsRefresh))] == ["refreshed"]


async def test_another_familys_refresh_while_one_runs(fam: dict[str, str], make_family: Any, jobs: FakeRunJob,
                                                      slow_pages: list[str]) -> None:
    other = make_family(1)["family_id"]
    first, second = await refresh_at_once(fam["id"], other)
    assert first.reason is None and second.reason == "too_soon" and second.refreshed is False
    assert second.next_refresh_at is not None
    assert jobs.jobs == ["digest"] and count(NewsRefresh) == 1


async def test_the_examples_never_replace_a_digest_stored_meanwhile(fam: dict[str, str],
                                                                    monkeypatch: pytest.MonkeyPatch) -> None:
    """No digest when the refresh starts and no model to build one; the weekly
    run stores a real digest while the refresh waits for Firecrawl. The
    refresh must keep it, not store the built-in examples over it."""
    week = weekly.iso_week()

    async def pages(urls: list[str]) -> list[dict[str, Any]]:
        await asyncio.sleep(0.01)
        weekly._save_digest(week, ["https://consumer.ftc.gov/consumer-alerts"], DIGEST["patterns"])
        return firecrawl.builtin_pages()

    monkeypatch.setattr(firecrawl, "fetch_warnings", pages)
    (body,) = await refresh_at_once(fam["id"])
    assert body.reason == "no_new_digest" and body.fallback is False
    assert [p.title for p in body.patterns] == ["Parcel fee calls", "A relative with a new number"]
    with new_session() as db:
        row = db.scalars(select(Digest)).one()
        assert not weekly._is_fallback(row) and row.week == week

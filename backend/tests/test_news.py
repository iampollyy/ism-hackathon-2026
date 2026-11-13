"""Track 4: the news screen and its refresh (services/news.py). The model
jobs are replaced and Firecrawl has no key (its built-in pages), so nothing
reaches the network."""

import json
from datetime import timedelta
from typing import Any

import pytest
from pydantic import BaseModel
from sqlalchemy import func, select

from app.agents import llm
from app.db import new_session, now_iso, parse_time, to_iso, utcnow
from app.models import Call, Digest, Member, Message, ModelRun, NewsRefresh
from app.routers import weekly
from app.services import firecrawl

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
        db.add(Digest(week="2026-W46", sources_json='["https://consumer.ftc.gov/consumer-alerts"]',
                      tactics_json=json.dumps(patterns), created_at="2026-11-14T09:30:00+00:00"))
        db.add(Message(member_id=fam["sara"], kind="weekly", text="Older note.", created_at="2026-11-07T10:00:00+00:00"))
        db.add(Message(member_id=fam["sara"], kind="weekly", text="Newest note.", created_at="2026-11-14T10:00:00+00:00"))
        db.add(Message(member_id=fam["sara"], kind="reminder", text="Not a note.", created_at="2026-11-14T11:00:00+00:00"))
        db.add(Message(member_id=fam["ana"], kind="weekly", text="Ana left.", created_at="2026-11-14T10:00:00+00:00"))
        db.get(Member, fam["ana"]).opted_out_at = now_iso()
        db.commit()

    body = client.get(f"/api/families/{fam['id']}/news").json()
    assert body["updated_at"] == "2026-11-14T09:30:00+00:00" and body["week"] == "2026-W46"
    assert body["fallback"] is False and body["next_refresh_at"] is None
    assert body["patterns"] == [
        {"title": "Parcel fee calls", "summary": "A caller asks for a small fee to release a parcel.",
         "tactics": [{"key": "small_ask_first", "label": "Small ask first"}, {"key": "urgency", "label": "Urgency"}],
         "closest_scenario": "bank_security",
         "sources": [{"url": "https://consumer.ftc.gov/consumer-alerts", "date": "2026-11-14"}]},
        {"title": "A relative with a new number", "summary": "Someone sounding like family needs money today.",
         "tactics": [{"key": "new_number", "label": "New number"}], "closest_scenario": "relative_new_number",
         "sources": []},  # a built-in example has no web address
    ]
    assert body["notes"] == [{"member": {"id": fam["sara"], "name": "Sara"}, "text": "Newest note.",
                              "when": "2026-11-14T10:00:00+00:00"}]


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
    assert len(body["patterns"]) == 2 and body["next_refresh_at"] is None
    assert jobs.jobs == ["digest"]


def test_refresh_without_a_model_stores_the_built_in_examples(client: Any, fam: dict[str, str],
                                                              make_family: Any) -> None:
    body = client.post(f"/api/families/{fam['id']}/news/refresh").json()
    assert body["refreshed"] is False and body["reason"] == "no_new_digest"
    assert body["fallback"] is True
    assert [p["title"] for p in body["patterns"]] == [p["title"] for p in weekly.FALLBACK_PATTERNS]
    assert all(pattern["sources"] == [] for pattern in body["patterns"])
    assert count(ModelRun) == 0 and count(Digest) == 1
    # Another family: the stored examples stay as they are.
    other = client.post(f"/api/families/{make_family(1)['family_id']}/news/refresh").json()
    assert other["reason"] == "no_new_digest" and other["patterns"] == body["patterns"] and count(Digest) == 1


def test_refresh_keeps_an_older_digest_when_no_model_answers(client: Any, fam: dict[str, str]) -> None:
    with new_session() as db:
        db.add(Digest(week="2026-W40", sources_json='["https://consumer.ftc.gov/consumer-alerts"]',
                      tactics_json=json.dumps(DIGEST["patterns"][:1]), created_at="2026-10-01T09:00:00+00:00"))
        db.commit()
    body = client.post(f"/api/families/{fam['id']}/news/refresh").json()
    assert body["reason"] == "no_new_digest" and body["week"] == "2026-W40"
    assert [p["title"] for p in body["patterns"]] == ["Parcel fee calls"] and count(Digest) == 1


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

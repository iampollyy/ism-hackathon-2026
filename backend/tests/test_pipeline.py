"""Track C tests: the after-call pipeline and the weekly run, with the model
jobs replaced (no network). OWNER: track C."""

import asyncio
import json
from datetime import timedelta
from typing import Any

import pytest
from pydantic import BaseModel
from sqlalchemy import select

from app import events
from app.agents import llm, scorer
from app.config import get_settings
from app.db import new_session, to_iso, utcnow
from app.ids import new_call_id
from app.models import Call, Consent, Digest, Member, Message, ModelRun, ReadinessSnapshot, Result
from app.routers import calls, weekly
from app.schemas import ApiError, READINESS_KEYS
from app.services import elevenlabs, pipeline


class FakeRunJob:
    def __init__(self) -> None:
        self.outputs: dict[str, Any] = {}
        self.jobs: list[str] = []

    async def __call__(self, job: str, *, system: str, user: str, schema: type[BaseModel],
                       prompt_version: str, max_tokens: int = 8000) -> BaseModel | None:
        self.jobs.append(job)
        output = self.outputs.get(job)
        if isinstance(output, Exception):
            raise output
        return schema.model_validate(output) if isinstance(output, dict) else output


@pytest.fixture
def jobs(monkeypatch: pytest.MonkeyPatch) -> FakeRunJob:
    fake = FakeRunJob()
    monkeypatch.setattr(llm, "run_job", fake)
    return fake


@pytest.fixture
def family(make_family: Any) -> dict[str, str]:
    body = make_family(2)
    return {"id": body["family_id"], "sara": body["members"][0]["id"], "jon": body["members"][1]["id"]}


def new_call(family: dict[str, str], kind: str = "practice", ended_by: str = "agent", seconds: float = 60,
             scenario: str | None = "relative_new_number", **fields: Any) -> str:
    call_id = new_call_id()
    answered = utcnow() - timedelta(seconds=seconds + 5)
    with new_session() as db:
        db.add(Call(id=call_id, family_id=family["id"], kind=kind, target_member_id=family["sara"],
                    scenario=scenario if kind == "practice" else None, difficulty=1, status="ended",
                    answered_at=to_iso(answered), ended_at=to_iso(answered + timedelta(seconds=seconds)),
                    ended_by=ended_by, created_at=to_iso(answered), **fields))
        db.commit()
    return call_id


def say(call_id: str, *items: tuple[str, dict[str, Any]]) -> None:
    for kind, data in items:
        events.publish(call_id, kind, data)


def get(model: type, key: Any) -> Any:
    with new_session() as db:
        return db.get(model, key)


def snapshots(member_id: str) -> list[dict[str, int]]:
    with new_session() as db:
        rows = db.scalars(select(ReadinessSnapshot).where(ReadinessSnapshot.member_id == member_id)
                          .order_by(ReadinessSnapshot.id))
        return [{item["key"]: item["score"] for item in json.loads(row.items_json)} for row in rows]


def plan_of(member_id: str) -> dict[str, Any]:
    return json.loads(get(Member, member_id).plan_json)


CHAT = (("turn", {"speaker": "agent", "text": "Mum? It's me, new number."}),
        ("tactic", {"key": "new_number", "label": "New number"}),
        ("turn", {"speaker": "user", "text": "What is our family word?"}))


# ---------------------------------------------------------------- practice


async def test_practice_without_any_model(client: Any, family: dict[str, str], jobs: FakeRunJob) -> None:
    call_id = new_call(family, seconds=5)  # answered ten seconds ago
    say(call_id, *CHAT, ("outcome", {"outcome": "asked_safe_word"}))
    await pipeline.after_call(call_id)

    result = get(Result, call_id)
    assert result.outcome == "asked_safe_word"
    assert result.seconds_to_challenge is not None and 0 <= result.seconds_to_challenge <= 30
    assert result.lesson == scorer.LESSONS["asked_safe_word"]
    assert json.loads(result.tactics_used_json) == ["new_number"]
    assert result.scorer_version == "fallback"
    assert get(Call, call_id).status == "scored"
    assert snapshots(family["sara"]) == [{"verify_first": 2, "safe_word": 2, "trusted_contact": 0,
                                          "payment_caution": 0, "under_pressure": 2}]
    published = [event for event in events.list_events(call_id) if event["type"] == "result"]
    assert published[0]["data"]["lesson"] == result.lesson and published[0]["data"]["outcome"] == "asked_safe_word"
    assert plan_of(family["sara"])["steps"][0]["status"] == "planned"
    assert jobs.jobs == ["scorer", "planner"]


async def test_practice_with_model_output(client: Any, family: dict[str, str], jobs: FakeRunJob) -> None:
    jobs.outputs["scorer"] = {"outcome": "hesitated", "tactics_used": ["urgency"], "tactics_worked": ["urgency"],
                              "lesson": "Pause, hang up, then ring the family number.", "debrief": "A. B. C."}
    jobs.outputs["planner"] = {"family_tasks": ["Agree a word.", "Save the number."], "members": [{
        "member_id": family["sara"], "weak_spot": "Rushed calls.", "this_week": "Save the number.",
        "steps": [{"when": "in two days", "scenario": "police", "difficulty": 1, "voice_of": None, "why": "Because."}]}]}
    call_id = new_call(family, ended_by="timeout")
    say(call_id, *CHAT[:1], ("tactic", {"key": "urgency", "label": "Urgency"}))
    await pipeline.after_call(call_id)

    result = get(Result, call_id)
    assert result.outcome == "hesitated" and result.seconds_to_challenge is None
    assert result.lesson == "Pause, hang up, then ring the family number."
    assert json.loads(result.tactics_worked_json) == ["urgency"]
    plan = plan_of(family["sara"])
    assert plan["steps"][0]["scenario"] == "police" and plan["family_tasks"] == ["Agree a word.", "Save the number."]


async def test_hanging_up_beats_the_scorer(client: Any, family: dict[str, str], jobs: FakeRunJob) -> None:
    jobs.outputs["scorer"] = {"outcome": "agreed", "tactics_used": [], "tactics_worked": [],
                              "lesson": "Hang up.", "debrief": "A. B. C."}
    call_id = new_call(family, ended_by="user", seconds=12)
    say(call_id, *CHAT[:1])
    await pipeline.after_call(call_id)
    result = get(Result, call_id)
    assert result.outcome == "hung_up"
    assert result.seconds_to_challenge == pytest.approx(12, abs=1)


async def test_family_number_tapped_while_the_scorer_runs(client: Any, family: dict[str, str],
                                                          monkeypatch: pytest.MonkeyPatch) -> None:
    call_id = new_call(family)
    say(call_id, *CHAT, ("outcome", {"outcome": "hesitated"}))

    async def slow_scorer(transcript: str, context: dict[str, Any]) -> dict[str, Any]:
        with new_session() as db:  # the phone taps the family number meanwhile
            db.get(Call, call_id).callback_seconds = 25.0
            db.commit()
        return scorer.fallback_score(context)

    monkeypatch.setattr(scorer, "score_call", slow_scorer)
    await pipeline.after_call(call_id)
    assert get(Result, call_id).callback_seconds == 25.0
    assert snapshots(family["sara"])[-1]["trusted_contact"] == 2


async def test_a_call_with_no_conversation_has_no_result(client: Any, family: dict[str, str], jobs: FakeRunJob) -> None:
    call_id = new_call(family, ended_by="error")
    await pipeline.after_call(call_id)
    assert get(Call, call_id).status == "scored"
    assert get(Result, call_id) is None
    assert snapshots(family["sara"]) == []
    assert jobs.jobs == []


async def test_only_ended_calls_are_scored_and_only_once(client: Any, family: dict[str, str], jobs: FakeRunJob) -> None:
    call_id = new_call(family)
    say(call_id, *CHAT, ("outcome", {"outcome": "hung_up"}))
    await pipeline.after_call(call_id)
    await pipeline.after_call(call_id)
    assert len(snapshots(family["sara"])) == 1
    assert jobs.jobs == ["scorer", "planner"]
    await pipeline.after_call("call_missing")


async def test_exceptions_never_escape(client: Any, family: dict[str, str], jobs: FakeRunJob,
                                       monkeypatch: pytest.MonkeyPatch) -> None:
    call_id = new_call(family)
    say(call_id, *CHAT, ("outcome", {"outcome": "hung_up"}))

    def broken(*args: Any, **kwargs: Any) -> None:
        raise RuntimeError("database fell over")

    monkeypatch.setattr(pipeline, "write_result", broken)
    await pipeline.after_call(call_id)
    assert get(Call, call_id).status == "ended"


async def test_no_rule_outcome_and_no_model_keeps_readiness(client: Any, family: dict[str, str],
                                                            jobs: FakeRunJob) -> None:
    with new_session() as db:  # an earlier snapshot with every item at 2
        db.add(ReadinessSnapshot(member_id=family["sara"], source_call_id=None, total=10, max=10,
                                 items_json=json.dumps([{"key": key, "score": 2} for key in READINESS_KEYS]),
                                 created_at=to_iso(utcnow() - timedelta(days=1))))
        db.commit()
    call_id = new_call(family, ended_by="timeout", callback_seconds=20.0)
    say(call_id, *CHAT)  # the agent never called practice_result
    await pipeline.after_call(call_id)
    result = get(Result, call_id)
    assert result.outcome == "hesitated" and result.scorer_version == "fallback"
    assert snapshots(family["sara"])[-1] == {key: 2 for key in READINESS_KEYS}, "a guess moves no score"


async def test_a_guess_still_counts_the_family_number(client: Any, family: dict[str, str], jobs: FakeRunJob) -> None:
    call_id = new_call(family, ended_by="timeout", callback_seconds=20.0)
    say(call_id, *CHAT)
    await pipeline.after_call(call_id)
    assert snapshots(family["sara"]) == [{"verify_first": 0, "safe_word": 0, "trusted_contact": 2,
                                          "payment_caution": 0, "under_pressure": 0}]


def test_grace_left_counts_from_the_end_of_the_call(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pipeline, "EVENT_GRACE_SECONDS", 2.0)
    assert pipeline.grace_left(to_iso(utcnow())) == pytest.approx(2.0, abs=0.2)
    assert pipeline.grace_left(to_iso(utcnow() - timedelta(seconds=1.5))) == pytest.approx(0.5, abs=0.2)
    assert pipeline.grace_left(to_iso(utcnow() - timedelta(seconds=10))) == 0.0
    assert pipeline.grace_left(to_iso(utcnow() + timedelta(seconds=60))) == 0.0
    assert pipeline.grace_left(None) == 0.0


async def test_a_batch_sent_just_after_the_end_is_scored(client: Any, family: dict[str, str], jobs: FakeRunJob,
                                                         monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pipeline, "EVENT_GRACE_SECONDS", 0.5)
    call_id = new_call(family, ended_by="user", seconds=30)
    with new_session() as db:  # the person tapped End just now
        db.get(Call, call_id).ended_at = to_iso(utcnow())
        db.commit()
    say(call_id, *CHAT)

    async def late_batch() -> None:
        await asyncio.sleep(0.1)
        say(call_id, ("outcome", {"outcome": "asked_safe_word", "seconds_to_challenge": 9.0}))

    await asyncio.gather(pipeline.after_call(call_id), late_batch())
    result = get(Result, call_id)
    assert result.outcome == "asked_safe_word", "not hung_up: the late outcome was read"
    assert result.seconds_to_challenge == 9.0


# ---------------------------------------------------------------- welcome and family line


async def test_welcome_without_any_model(client: Any, make_family: Any, jobs: FakeRunJob) -> None:
    body = make_family(2, consent=False)
    fam = {"id": body["family_id"], "sara": body["members"][0]["id"], "jon": body["members"][1]["id"]}
    call_id = new_call(fam, kind="welcome")
    say(call_id, ("turn", {"speaker": "agent", "text": "Are you happy to get practice calls?"}),
        ("turn", {"speaker": "user", "text": "Yes."}), ("consent", {"given": True}))
    await pipeline.after_call(call_id)

    assert get(Call, call_id).status == "scored"
    profile = json.loads(get(Member, fam["sara"]).profile_json)
    assert profile["source"] == "fallback" and profile["consent_practice"] is True
    assert snapshots(fam["sara"]) == [{key: 0 for key in READINESS_KEYS}]
    assert get(Member, fam["sara"]).consent_practice_at is not None
    for member_id in (fam["sara"], fam["jon"]):
        assert plan_of(member_id)["steps"][0]["scenario"] == "relative_new_number"
    assert jobs.jobs == ["profiler", "planner"]


async def test_welcome_with_model_output_and_no_second_before(client: Any, family: dict[str, str], jobs: FakeRunJob) -> None:
    jobs.outputs["profiler"] = {
        "consent_practice": True, "consent_quote": "Yes, happy to.", "trusts_most": "bank",
        "said": "If the bank rings, I do what they say.", "weak_spot": "Official callers.",
        "items": [{"key": key, "score": 1, "evidence": "quote"} for key in READINESS_KEYS],
    }
    with new_session() as db:  # the consent event already wrote its row (track B)
        db.add(Consent(member_id=family["sara"], kind="practice", source="welcome_call", evidence="event",
                       created_at=to_iso(utcnow())))
        db.commit()
    first = new_call(family, kind="welcome")
    say(first, ("turn", {"speaker": "user", "text": "Yes."}))
    await pipeline.after_call(first)
    assert snapshots(family["sara"]) == [{key: 1 for key in READINESS_KEYS}]
    assert plan_of(family["sara"])["steps"][0]["scenario"] == "bank_security"
    second = new_call(family, kind="welcome")
    say(second, ("turn", {"speaker": "user", "text": "Yes."}))
    await pipeline.after_call(second)
    assert snapshots(family["sara"]) == [{key: 1 for key in READINESS_KEYS}], "a second welcome replaces 'before'"
    with new_session() as db:
        sources = [row.source for row in db.scalars(select(Consent).where(Consent.member_id == family["sara"]))]
    assert sorted(sources) == ["manual", "welcome_call"]


PROFILE_TWOS = {
    "consent_practice": True, "consent_quote": "Yes.", "trusts_most": "bank",
    "said": "I do what the bank says.", "weak_spot": "Official callers.",
    "items": [{"key": key, "score": 2, "evidence": "quote"} for key in READINESS_KEYS],
}


def snapshot_sources(member_id: str) -> list[str | None]:
    with new_session() as db:
        rows = db.scalars(select(ReadinessSnapshot).where(ReadinessSnapshot.member_id == member_id))
        return [row.source_call_id for row in rows]


async def test_a_silent_welcome_changes_nothing_but_consent(client: Any, make_family: Any, jobs: FakeRunJob) -> None:
    body = make_family(2, consent=False)
    fam = {"id": body["family_id"], "sara": body["members"][0]["id"], "jon": body["members"][1]["id"]}
    call_id = new_call(fam, kind="welcome", ended_by="error")
    say(call_id, ("consent", {"given": True}))
    await pipeline.after_call(call_id)
    sara = get(Member, fam["sara"])
    assert get(Call, call_id).status == "scored"
    assert sara.profile_json is None and sara.plan_json is None
    assert snapshots(fam["sara"]) == []
    assert sara.consent_practice_at is not None, "an explicit consent event still counts"
    assert jobs.jobs == []


async def test_a_good_welcome_after_a_silent_one_sets_before(client: Any, family: dict[str, str],
                                                             jobs: FakeRunJob) -> None:
    silent = new_call(family, kind="welcome", ended_by="error")
    await pipeline.after_call(silent)
    jobs.outputs["profiler"] = PROFILE_TWOS
    good = new_call(family, kind="welcome")
    say(good, ("turn", {"speaker": "user", "text": "Yes."}))
    await pipeline.after_call(good)
    assert snapshots(family["sara"]) == [{key: 2 for key in READINESS_KEYS}]
    assert json.loads(get(Member, family["sara"]).profile_json)["trusts_most"] == "bank"


async def test_a_model_welcome_replaces_a_fallback_before(client: Any, family: dict[str, str],
                                                          jobs: FakeRunJob) -> None:
    first = new_call(family, kind="welcome")
    say(first, ("turn", {"speaker": "user", "text": "Yes."}))
    await pipeline.after_call(first)  # no model output: the fallback, all 0
    assert snapshots(family["sara"]) == [{key: 0 for key in READINESS_KEYS}]
    jobs.outputs["profiler"] = PROFILE_TWOS
    second = new_call(family, kind="welcome")
    say(second, ("turn", {"speaker": "user", "text": "Yes."}))
    await pipeline.after_call(second)
    assert snapshots(family["sara"]) == [{key: 2 for key in READINESS_KEYS}]
    assert snapshot_sources(family["sara"]) == [second]
    view = next(m for m in client.get(f"/api/families/{family['id']}").json()["members"] if m["id"] == family["sara"])
    assert view["readiness"]["before"] == 10 and view["readiness"]["now"] == 10


async def test_a_failed_or_silent_welcome_keeps_a_good_profile(client: Any, family: dict[str, str],
                                                               jobs: FakeRunJob) -> None:
    jobs.outputs["profiler"] = PROFILE_TWOS
    good = new_call(family, kind="welcome")
    say(good, ("turn", {"speaker": "user", "text": "Yes."}))
    await pipeline.after_call(good)
    jobs.outputs["profiler"] = None  # every model fails from now on
    failed = new_call(family, kind="welcome")
    say(failed, ("turn", {"speaker": "user", "text": "Hello?"}))
    await pipeline.after_call(failed)
    silent = new_call(family, kind="welcome", ended_by="error")
    await pipeline.after_call(silent)
    assert json.loads(get(Member, family["sara"]).profile_json)["trusts_most"] == "bank"
    assert snapshots(family["sara"]) == [{key: 2 for key in READINESS_KEYS}]
    assert snapshot_sources(family["sara"]) == [good]


async def test_a_welcome_after_a_practice_keeps_the_scores(client: Any, family: dict[str, str],
                                                           jobs: FakeRunJob) -> None:
    practice = new_call(family)
    say(practice, *CHAT, ("outcome", {"outcome": "hung_up"}))
    await pipeline.after_call(practice)
    jobs.outputs["profiler"] = PROFILE_TWOS
    welcome = new_call(family, kind="welcome")
    say(welcome, ("turn", {"speaker": "user", "text": "Yes."}))
    await pipeline.after_call(welcome)
    assert snapshot_sources(family["sara"]) == [practice], "after a practice only practices move the scores"
    assert json.loads(get(Member, family["sara"]).profile_json)["trusts_most"] == "bank"


async def test_family_line_is_only_marked_scored(client: Any, family: dict[str, str], jobs: FakeRunJob) -> None:
    call_id = new_call(family, kind="family_line")
    say(call_id, ("turn", {"speaker": "agent", "text": "Family line."}))
    await pipeline.after_call(call_id)
    assert get(Call, call_id).status == "scored"
    assert jobs.jobs == []


# ---------------------------------------------------------------- ElevenLabs' transcript


async def test_transcript_is_saved_in_the_background(client: Any, family: dict[str, str], jobs: FakeRunJob,
                                                     monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FAKE_ELEVENLABS", "false")
    get_settings.cache_clear()
    monkeypatch.setattr(pipeline, "TRANSCRIPT_POLL_SECONDS", 0.01)
    answers = [{"status": "processing"}, {"status": "done", "transcript": [{"role": "agent", "message": "hi"}]}]

    async def get_conversation(conversation_id: str) -> dict[str, Any]:
        return answers.pop(0)

    monkeypatch.setattr(elevenlabs, "get_conversation", get_conversation)
    call_id = new_call(family, conversation_id="conv_1")
    say(call_id, *CHAT, ("outcome", {"outcome": "hung_up"}))
    await pipeline.after_call(call_id)
    path = pipeline.transcript_path(call_id)
    for _ in range(100):
        if path.exists():
            break
        await asyncio.sleep(0.01)
    saved = json.loads(path.read_text())
    assert saved["conversation_id"] == "conv_1" and saved["transcript"][0]["message"] == "hi"


# ---------------------------------------------------------------- the weekly run


@pytest.fixture
def created(monkeypatch: pytest.MonkeyPatch, family: dict[str, str]) -> list[dict[str, Any]]:
    """Replaces track B's create_practice with one that stores a scheduled call."""
    seen: list[dict[str, Any]] = []

    async def create_practice(db: Any, target_member_id: str, voice_member_id: str | None, scenario: str,
                              difficulty: int, delay_seconds: int = 0, check_phone_online: bool = True) -> Call:
        seen.append({"target": target_member_id, "scenario": scenario, "delay": delay_seconds,
                     "check": check_phone_online})
        call = Call(id=new_call_id(), family_id=family["id"], kind="practice", target_member_id=target_member_id,
                    scenario=scenario, difficulty=difficulty, status="scheduled",
                    scheduled_for=to_iso(utcnow() + timedelta(seconds=delay_seconds)), created_at=to_iso(utcnow()))
        db.add(call)
        db.commit()
        return call

    monkeypatch.setattr(calls, "create_practice", create_practice)
    return seen


def give_plan(member_id: str, when: str = "in three days") -> None:
    plan = {"member_id": member_id, "weak_spot": "Official callers.", "this_week": "Save the number.",
            "family_tasks": ["Agree a word in person.", "Save the family number."],
            "steps": [{"when": when, "scenario": "police", "difficulty": 1, "voice_of": None,
                       "why": "Because.", "status": "planned"}]}
    with new_session() as db:
        db.get(Member, member_id).plan_json = json.dumps(plan)
        db.commit()


def test_weekly_run_one_action_each(client: Any, family: dict[str, str], created: list[dict[str, Any]]) -> None:
    give_plan(family["sara"])
    body = client.post(f"/api/families/{family['id']}/weekly-run").json()
    actions = {action["member_id"]: action for action in body["actions"]}
    assert actions[family["sara"]]["kind"] == "practice"
    assert created == [{"target": family["sara"], "scenario": "police", "delay": 3 * 86400, "check": False}]
    assert plan_of(family["sara"])["steps"][0]["status"] == "scheduled"
    assert actions[family["jon"]]["kind"] == "message"
    with new_session() as db:
        message = db.scalars(select(Message).where(Message.member_id == family["jon"])).one()
    assert message.kind == "weekly" and message.text == actions[family["jon"]]["text"]
    assert len(body["digest"]["patterns"]) == 3
    # Run again: the step is scheduled now, so Sara gets a message instead.
    again = client.post(f"/api/families/{family['id']}/weekly-run").json()
    assert {action["kind"] for action in again["actions"]} == {"message"}


def test_refused_practice_becomes_a_reminder(client: Any, family: dict[str, str],
                                             monkeypatch: pytest.MonkeyPatch) -> None:
    async def refuse(*args: Any, **kwargs: Any) -> Call:
        raise ApiError(409, "voice_not_ready", "No voice.")

    monkeypatch.setattr(calls, "create_practice", refuse)
    give_plan(family["sara"])
    body = client.post(f"/api/families/{family['id']}/weekly-run").json()
    sara = next(action for action in body["actions"] if action["member_id"] == family["sara"])
    assert sara["kind"] == "reminder" and sara["text"] == "Agree a word in person."
    assert plan_of(family["sara"])["steps"][0]["status"] == "planned"


def test_digest_fallback_is_stored_once_and_replaced_by_a_real_one(client: Any, family: dict[str, str],
                                                                    created: list[dict[str, Any]],
                                                                    monkeypatch: pytest.MonkeyPatch) -> None:
    first = client.post(f"/api/families/{family['id']}/weekly-run").json()["digest"]
    assert [p["source_url"] for p in first["patterns"]][0].startswith("builtin:")
    fake = FakeRunJob()
    fake.outputs["digest"] = {"patterns": [{"title": "New trick", "summary": "A caller does a new thing.",
                                            "tactics": ["urgency"], "closest_scenario": "police",
                                            "source_url": "builtin:police-safe-account"}]}
    monkeypatch.setattr(llm, "run_job", fake)
    second = client.post(f"/api/families/{family['id']}/weekly-run").json()["digest"]
    third = client.post(f"/api/families/{family['id']}/weekly-run").json()["digest"]
    assert [p["title"] for p in second["patterns"]] == ["New trick"] == [p["title"] for p in third["patterns"]]
    assert fake.jobs.count("digest") == 1
    with new_session() as db:
        assert len(list(db.scalars(select(Digest)))) == 1


def test_weekly_run_never_calls_a_model_without_keys(client: Any, family: dict[str, str]) -> None:
    assert client.post(f"/api/families/{family['id']}/weekly-run").status_code == 200
    with new_session() as db:
        assert list(db.scalars(select(ModelRun))) == []


@pytest.mark.parametrize("when, seconds", [
    ("today", 120), ("tomorrow", 86400), ("in three days", 3 * 86400), ("in 2 hours", 7200),
    ("in a week", 7 * 86400), ("in 30 days", 7 * 86400), ("whenever", 120), (None, 120),
])
def test_delay_from_the_plan_step(when: str | None, seconds: int) -> None:
    assert weekly.delay_seconds(when) == seconds

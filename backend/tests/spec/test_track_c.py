"""Spec tests for Track C (AI jobs, outcome rules, readiness, after-call pipeline, weekly run).

Written from docs/backend.md ("After a call ends", "Deciding the outcome, by rule",
"The weekly run"), docs/ai.md ("The model jobs", "How one person's answers shape
their calls", "The readiness scale", "Checking quality") and the interface list,
without reading the Track C implementation.

How the model layer is faked:
- `jobs` fixture replaces `run_job` (in agents.llm and in every module that
  imported it by name) with a recorder that returns what the test queued per job.
- The llm.run_job tests patch the SDK methods `AsyncMessages.parse` and
  `AsyncResponses.parse` instead (the SDKs run on httpx2, which respx cannot see).
"""

import asyncio
import importlib
import json
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
import respx
from anthropic.resources.messages import AsyncMessages
from openai.resources.responses import AsyncResponses
from pydantic import BaseModel, ValidationError
from sqlalchemy import select

from app import events as app_events
from app.config import get_settings
from app.db import new_session, to_iso, utcnow
from app.ids import new_call_id
from app.models import Call, CallEvent, Consent, Digest, Member, Message, ModelRun, ReadinessSnapshot, Result
from app.schemas import ApiError, OUTCOMES, READINESS_KEYS, SCENARIOS, TACTICS

DOCS_AI = Path(__file__).resolve().parents[3] / "docs" / "ai.md"
PROMPTS_DIR = Path(__file__).resolve().parents[2] / "app" / "agents" / "prompts"

SAFE_OUTCOMES = ("asked_safe_word", "hung_up", "asked_personal_question")
ALL_ONES = {key: 1 for key in READINESS_KEYS}


# ============================================================ helpers: model fakes


class FakeJobs:
    """Stands in for agents.llm.run_job. Queue a response per job name:
    a dict (validated against the schema the caller passed), a model instance,
    None, or an Exception instance (raised). Jobs with no response return None."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.responses: dict[str, Any] = {}

    def set(self, job: str, response: Any) -> None:
        self.responses[job] = response

    def names(self) -> list[str]:
        return [call["job"] for call in self.calls]

    def calls_for(self, job: str) -> list[dict[str, Any]]:
        return [call for call in self.calls if call["job"] == job]

    async def run_job(self, job: str, *, system: str, user: str, schema: type[BaseModel],
                      prompt_version: str, max_tokens: int = 8000) -> BaseModel | None:
        self.calls.append({"job": job, "system": system, "user": user, "schema": schema,
                           "prompt_version": prompt_version, "max_tokens": max_tokens})
        response = self.responses.get(job)
        if isinstance(response, Exception):
            raise response
        if response is None or isinstance(response, BaseModel):
            return response
        try:
            return schema.model_validate(response)
        except ValidationError:
            return None


PATCHED_MODULES = (
    "app.agents.profiler", "app.agents.planner", "app.agents.director", "app.agents.scorer",
    "app.agents.digest", "app.services.pipeline", "app.routers.weekly",
)


@pytest.fixture
def jobs(monkeypatch: pytest.MonkeyPatch) -> FakeJobs:
    fake = FakeJobs()
    llm = importlib.import_module("app.agents.llm")
    monkeypatch.setattr(llm, "run_job", fake.run_job)
    for name in PATCHED_MODULES:
        module = importlib.import_module(name)
        if hasattr(module, "run_job"):
            monkeypatch.setattr(module, "run_job", fake.run_job)
    return fake


def profile_payload(scores: dict[str, int] | None = None, trusts: str = "bank", consent: bool = True,
                    said: str = "If the bank rings, I do what they say.",
                    weak: str = "Official-sounding callers feel hard to question.") -> dict[str, Any]:
    scores = scores or {}
    return {
        "consent_practice": consent,
        "consent_quote": "Yes, that is fine.",
        "items": [{"key": key, "score": scores.get(key, 0), "evidence": "a short quote"} for key in READINESS_KEYS],
        "trusts_most": trusts,
        "said": said,
        "weak_spot": weak,
    }


def score_payload(outcome: str = "asked_safe_word", used: list[str] | None = None,
                  worked: list[str] | None = None,
                  lesson: str = "You paused and checked, so next time hang up and call the family number.",
                  debrief: str = "The caller posed as a bank. You asked for the family word. Next time, hang up and call back.",
                  ) -> dict[str, Any]:
    return {"outcome": outcome, "tactics_used": used or [], "tactics_worked": worked or [],
            "lesson": lesson, "debrief": debrief}


def plan_payload(member_ids: list[str], steps: list[dict[str, Any]] | None = None,
                 weak: str = "Trusting official-sounding callers.",
                 this_week: str = "Save the family number in your phone.") -> dict[str, Any]:
    """Valid for both FamilyPlan (members + family_tasks) and a single MemberPlan."""
    steps = steps if steps is not None else [plan_step()]
    members = [{"member_id": member_id, "weak_spot": weak, "this_week": this_week, "steps": steps}
               for member_id in member_ids]
    return {"members": members, "family_tasks": ["Agree the family word in person.", "Save the family number."],
            "member_id": member_ids[0], "weak_spot": weak, "this_week": this_week, "steps": steps}


def plan_step(scenario: str = "police", difficulty: int = 1, voice_of: str | None = None) -> dict[str, Any]:
    return {"when": "in three days", "scenario": scenario, "difficulty": difficulty,
            "voice_of": voice_of, "why": "Because you said you would do what the bank says."}


# ============================================================ helpers: database


def load(model: type, key: Any) -> Any:
    with new_session() as session:
        return session.get(model, key)


def snapshots(member_id: str) -> list[ReadinessSnapshot]:
    with new_session() as session:
        return list(session.scalars(
            select(ReadinessSnapshot).where(ReadinessSnapshot.member_id == member_id).order_by(ReadinessSnapshot.id)))


def snapshot_scores(snapshot: ReadinessSnapshot) -> dict[str, int]:
    return {item["key"]: item["score"] for item in json.loads(snapshot.items_json)}


def add_snapshot(member_id: str, scores: dict[str, int], source_call_id: str | None = None) -> None:
    items = [{"key": key, "score": scores.get(key, 0)} for key in READINESS_KEYS]
    with new_session() as session:
        session.add(ReadinessSnapshot(member_id=member_id, source_call_id=source_call_id,
                                      items_json=json.dumps(items), total=sum(scores.values()), max=10,
                                      created_at=to_iso(utcnow() - timedelta(days=1))))
        session.commit()


def model_runs() -> list[ModelRun]:
    with new_session() as session:
        return list(session.scalars(select(ModelRun).order_by(ModelRun.id)))


def stored_events(call_id: str) -> list[dict[str, Any]]:
    return app_events.list_events(call_id)


def make_call(family_id: str, target_id: str, kind: str = "practice", *, status: str = "ended",
              ended_by: str | None = "agent", scenario: str | None = "bank_security", difficulty: int = 1,
              duration: float = 60.0, hours_ago: float = 0.0, voice_member_id: str | None = None,
              answered: bool = True, callback_seconds: float | None = None,
              conversation_id: str | None = None) -> str:
    """Insert a finished call. Answered 60 seconds ago (plus hours_ago), ended `duration` later."""
    call_id = new_call_id()
    base = utcnow() - timedelta(hours=hours_ago, seconds=70)
    with new_session() as session:
        session.add(Call(
            id=call_id, family_id=family_id, kind=kind, target_member_id=target_id,
            voice_member_id=voice_member_id, scenario=scenario if kind == "practice" else None,
            difficulty=difficulty, status=status,
            answered_at=to_iso(base) if answered else None,
            ended_at=to_iso(base + timedelta(seconds=duration)) if answered else None,
            ended_by=ended_by, callback_seconds=callback_seconds, conversation_id=conversation_id,
            created_at=to_iso(base - timedelta(seconds=5)),
        ))
        session.commit()
    return call_id


def add_events(call_id: str, items: list[tuple[str, dict[str, Any], float]]) -> None:
    """items: (type, data, t). created_at is answered_at + t, so server times are exact."""
    with new_session() as session:
        call = session.get(Call, call_id)
        answered = datetime.fromisoformat(call.answered_at)
        seq = len(list(session.scalars(select(CallEvent).where(CallEvent.call_id == call_id))))
        for kind, data, t in items:
            seq += 1
            session.add(CallEvent(call_id=call_id, seq=seq, type=kind, t=t, data_json=json.dumps(data),
                                  created_at=to_iso(answered + timedelta(seconds=t))))
        session.commit()


def turns(*lines: tuple[str, str]) -> list[tuple[str, dict[str, Any], float]]:
    return [("turn", {"speaker": speaker, "text": text}, 2.0 + 3.0 * index)
            for index, (speaker, text) in enumerate(lines)]


PRACTICE_TURNS = turns(("agent", "Hello, this is your bank's security team."),
                       ("user", "Which bank? What is our family word?"))


def add_prior_practice(family_id: str, target_id: str, outcome: str, scenario: str, hours_ago: float,
                       difficulty: int = 1) -> str:
    call_id = make_call(family_id, target_id, status="scored", scenario=scenario, difficulty=difficulty,
                        hours_ago=hours_ago)
    with new_session() as session:
        session.add(Result(call_id=call_id, outcome=outcome, seconds_to_challenge=None,
                           tactics_used_json="[]", tactics_worked_json="[]", lesson="earlier lesson",
                           created_at=to_iso(utcnow() - timedelta(hours=hours_ago))))
        session.commit()
    return call_id


async def run_after_call(call_id: str) -> None:
    pipeline = importlib.import_module("app.services.pipeline")
    await asyncio.wait_for(pipeline.after_call(call_id), 20)


def family_view(client: Any, family_id: str) -> dict[str, Any]:
    response = client.get(f"/api/families/{family_id}")
    assert response.status_code == 200, response.text
    return response.json()


def member_plan(member_id: str) -> dict[str, Any]:
    member = load(Member, member_id)
    assert member.plan_json, "the member should have a stored plan"
    return json.loads(member.plan_json)


def ids_of(family: dict[str, Any]) -> tuple[str, str, str]:
    return family["family_id"], family["members"][0]["id"], family["members"][1]["id"]


# ============================================================ outcome rules (backend.md "Deciding the outcome, by rule")

from app.services.outcome import OutcomeDecision, decide_outcome  # noqa: E402

T0 = datetime(2026, 11, 13, 12, 0, 0, tzinfo=timezone.utc)


def ev(seq: int, kind: str, data: dict[str, Any] | None = None, t: float = 0.0) -> dict[str, Any]:
    return {"call_id": "call_x", "seq": seq, "type": kind, "t": t, "data": data or {},
            "created_at": to_iso(T0 + timedelta(seconds=t))}


def decide(events: list[dict[str, Any]], ended_by: str | None, ended_after: float | None = 60.0) -> OutcomeDecision:
    ended_at = None if ended_after is None else T0 + timedelta(seconds=ended_after)
    return decide_outcome(events, ended_by, T0, ended_at)


def test_rule1_user_ended_before_any_outcome_is_hung_up() -> None:
    decision = decide([ev(1, "turn", {"speaker": "agent", "text": "Hi"}, 2), ev(2, "tactic", {"key": "urgency"}, 5)],
                      "user", ended_after=25.0)
    assert decision.outcome == "hung_up"
    assert decision.seconds_to_challenge == pytest.approx(25.0, abs=0.5)


def test_rule1_hung_up_with_no_events_at_all() -> None:
    decision = decide([], "user", ended_after=8.0)
    assert decision.outcome == "hung_up"
    assert decision.seconds_to_challenge == pytest.approx(8.0, abs=0.5)


@pytest.mark.parametrize("outcome, seconds", [
    ("asked_safe_word", 14.0), ("hung_up", 14.0), ("asked_personal_question", 14.0),
    ("hesitated", None), ("agreed", None),
])
def test_rule2_agent_outcome_and_seconds(outcome: str, seconds: float | None) -> None:
    decision = decide([ev(1, "turn", {"speaker": "agent", "text": "x"}, 3), ev(2, "outcome", {"outcome": outcome}, 14)],
                      "agent")
    assert decision.outcome == outcome
    if seconds is None:
        assert decision.seconds_to_challenge is None
    else:
        assert decision.seconds_to_challenge == pytest.approx(seconds, abs=0.5)


def test_rule2_outcome_event_beats_user_tapping_end_after_it() -> None:
    decision = decide([ev(1, "outcome", {"outcome": "asked_safe_word"}, 10)], "user", ended_after=40.0)
    assert decision.outcome == "asked_safe_word"
    assert decision.seconds_to_challenge == pytest.approx(10.0, abs=0.5)


def test_rule2_user_ends_after_agreed_stays_agreed_with_no_seconds() -> None:
    decision = decide([ev(1, "outcome", {"outcome": "agreed"}, 20)], "user", ended_after=45.0)
    assert decision.outcome == "agreed"
    assert decision.seconds_to_challenge is None


def test_rule2_timeout_with_outcome_event_keeps_it() -> None:
    decision = decide([ev(1, "outcome", {"outcome": "hesitated"}, 100)], "timeout", ended_after=180.0)
    assert decision.outcome == "hesitated"


def test_rule2_first_outcome_event_counts() -> None:
    decision = decide([ev(1, "outcome", {"outcome": "asked_safe_word"}, 10), ev(2, "outcome", {"outcome": "agreed"}, 30)],
                      "agent")
    assert decision.outcome == "asked_safe_word"
    assert decision.seconds_to_challenge == pytest.approx(10.0, abs=0.5)


@pytest.mark.parametrize("ended_by", ["agent", "timeout", "error", None])
def test_rule3_no_outcome_and_not_user_ended_leaves_outcome_to_the_scorer(ended_by: str | None) -> None:
    decision = decide([ev(1, "turn", {"speaker": "agent", "text": "Hi"}, 2)], ended_by)
    assert decision.outcome is None
    assert decision.seconds_to_challenge is None


def test_rule1_without_answered_at_does_not_crash() -> None:
    decision = decide_outcome([], "user", None, T0)
    assert decision.outcome == "hung_up"
    assert decision.seconds_to_challenge is None


# ============================================================ readiness (ai.md "The readiness scale")

from app.services import readiness  # noqa: E402


def test_readiness_constants_and_callback_rule() -> None:
    assert readiness.CALLBACK_WITHIN_SECONDS == 60.0


@pytest.mark.parametrize("seconds, expected", [(0.0, 2), (30.0, 2), (60.0, 2), (60.5, 0), (600.0, 0), (-1.0, 0), (None, 0)])
def test_apply_callback_trusted_contact(seconds: float | None, expected: int) -> None:
    scores = {key: 0 for key in READINESS_KEYS}
    assert readiness.apply_callback(scores, seconds)["trusted_contact"] == expected


def test_apply_callback_is_pure_and_keeps_other_items() -> None:
    scores = {"verify_first": 1, "safe_word": 1, "trusted_contact": 0, "payment_caution": 2, "under_pressure": 1}
    original = dict(scores)
    result = readiness.apply_callback(scores, 10.0)
    assert scores == original
    assert result is not scores
    assert {k: v for k, v in result.items() if k != "trusted_contact"} == {
        k: v for k, v in original.items() if k != "trusted_contact"}


@pytest.mark.parametrize("seconds, under_pressure", [(10.0, 2), (29.9, 2), (30.1, 1), (45.0, 1), (None, 1)])
def test_asked_safe_word_scores(seconds: float | None, under_pressure: int) -> None:
    result = readiness.apply_result(dict(ALL_ONES) | {"safe_word": 0, "verify_first": 0}, "asked_safe_word",
                                    seconds, None)
    assert result["verify_first"] == 2
    assert result["safe_word"] == 2
    assert result["under_pressure"] == under_pressure
    assert result["payment_caution"] == 1 and result["trusted_contact"] == 1


@pytest.mark.parametrize("seconds, under_pressure", [(5.0, 2), (29.9, 2), (30.1, 1), (90.0, 1)])
def test_hung_up_scores_and_leaves_safe_word_alone(seconds: float, under_pressure: int) -> None:
    start = dict(ALL_ONES) | {"verify_first": 0, "under_pressure": 0, "safe_word": 0}
    result = readiness.apply_result(start, "hung_up", seconds, None)
    assert result["verify_first"] == 2
    assert result["under_pressure"] == under_pressure
    assert result["safe_word"] == 0


@pytest.mark.parametrize("verify_before, verify_after", [(0, 1), (1, 1), (2, 2)])
def test_asked_personal_question_verify_first(verify_before: int, verify_after: int) -> None:
    start = dict(ALL_ONES) | {"verify_first": verify_before, "under_pressure": 0}
    result = readiness.apply_result(start, "asked_personal_question", 12.0, None)
    assert result["verify_first"] == verify_after
    assert result["under_pressure"] == 1
    assert result["safe_word"] == 1


def test_hesitated_scores() -> None:
    start = dict(ALL_ONES) | {"verify_first": 0, "under_pressure": 0, "payment_caution": 2}
    result = readiness.apply_result(start, "hesitated", None, None)
    assert result["verify_first"] == 1
    assert result["under_pressure"] == 1
    assert result["payment_caution"] == 2


def test_agreed_scores() -> None:
    start = {key: 2 for key in READINESS_KEYS}
    result = readiness.apply_result(start, "agreed", None, None)
    assert result["verify_first"] == 0
    assert result["under_pressure"] == 0
    assert result["payment_caution"] == 0
    assert result["safe_word"] == 2 and result["trusted_contact"] == 2


def test_apply_result_includes_the_callback_rule() -> None:
    start = {key: 0 for key in READINESS_KEYS}
    assert readiness.apply_result(start, "hesitated", None, 20.0)["trusted_contact"] == 2
    assert readiness.apply_result(start, "hesitated", None, 75.0)["trusted_contact"] == 0
    assert readiness.apply_result(start, "hesitated", None, None)["trusted_contact"] == 0


@pytest.mark.parametrize("outcome", OUTCOMES)
def test_apply_result_clamps_every_score_and_keeps_the_five_keys(outcome: str) -> None:
    start = {"verify_first": 9, "safe_word": -4, "trusted_contact": 7, "payment_caution": 5, "under_pressure": -1}
    result = readiness.apply_result(start, outcome, 10.0, 5.0)
    assert set(result) == set(READINESS_KEYS)
    assert all(isinstance(value, int) and 0 <= value <= 2 for value in result.values())


def test_apply_result_does_not_change_its_input() -> None:
    start = dict(ALL_ONES)
    readiness.apply_result(start, "agreed", None, 5.0)
    assert start == ALL_ONES


# ============================================================ prompt files (ai.md "The job prompts")


def ai_md_prompt(heading: str) -> str:
    text = DOCS_AI.read_text()
    after = text.split(f"\n**{heading}**\n", 1)[1]
    block = after.split("```text", 1)[1].split("```", 1)[0]
    return " ".join(block.split())


@pytest.mark.parametrize("job, heading", [("profiler", "Profiler"), ("planner", "Planner"), ("director", "Director"),
                                          ("scorer", "Scorer"), ("digest", "Digest")])
def test_prompt_files_are_copied_verbatim_from_ai_md(job: str, heading: str) -> None:
    path = PROMPTS_DIR / f"{job}.v1.md"
    assert path.exists(), f"{path.name} is missing"
    assert " ".join(path.read_text().split()) == ai_md_prompt(heading)


def test_there_is_a_prompt_for_the_weekly_note() -> None:
    names = {path.name for path in PROMPTS_DIR.glob("*.v1.md")}
    extra = names - {f"{job}.v1.md" for job in ("profiler", "planner", "director", "scorer", "digest")}
    assert extra, "expected a sixth prompt file for the weekly note"


# ============================================================ agents/llm.run_job


class Answer(BaseModel):
    answer: str


class SdkFakes:
    """Replaces the two SDK parse methods and records how they were called."""

    def __init__(self) -> None:
        self.claude_calls: list[dict[str, Any]] = []
        self.openai_calls: list[dict[str, Any]] = []
        self.claude_reply: Any = None
        self.openai_reply: Any = None

    @staticmethod
    def _play(reply: Any) -> Any:
        if isinstance(reply, Exception):
            raise reply
        return reply

    async def claude_parse(self, _self: Any, **kwargs: Any) -> Any:
        self.claude_calls.append(kwargs)
        if callable(self.claude_reply):
            return await self.claude_reply()
        return self._play(self.claude_reply)

    async def openai_parse(self, _self: Any, **kwargs: Any) -> Any:
        self.openai_calls.append(kwargs)
        return self._play(self.openai_reply)


def claude_ok(answer: str = "from claude") -> Any:
    return SimpleNamespace(stop_reason="end_turn", parsed_output=Answer(answer=answer),
                           usage=SimpleNamespace(input_tokens=5, output_tokens=7))


def openai_ok(answer: str = "from openai") -> Any:
    return SimpleNamespace(output_parsed=Answer(answer=answer), status="completed",
                           usage=SimpleNamespace(input_tokens=3, output_tokens=4))


@pytest.fixture
def sdk(monkeypatch: pytest.MonkeyPatch) -> SdkFakes:
    fake = SdkFakes()

    async def claude(self: Any, **kwargs: Any) -> Any:
        return await fake.claude_parse(self, **kwargs)

    async def openai(self: Any, **kwargs: Any) -> Any:
        return await fake.openai_parse(self, **kwargs)

    monkeypatch.setattr(AsyncMessages, "parse", claude)
    monkeypatch.setattr(AsyncResponses, "parse", openai)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    get_settings.cache_clear()
    return fake


async def run_scorer_job(**overrides: Any) -> Any:
    llm = importlib.import_module("app.agents.llm")
    kwargs: dict[str, Any] = {"system": "SYSTEM TEXT", "user": "USER TEXT", "schema": Answer, "prompt_version": "scorer.v1"}
    kwargs.update(overrides)
    return await llm.run_job("scorer", **kwargs)


async def test_claude_first_uses_messages_parse_with_the_documented_shape(sdk: SdkFakes) -> None:
    sdk.claude_reply = claude_ok()
    result = await run_scorer_job(max_tokens=1234)
    assert result == Answer(answer="from claude")
    assert len(sdk.claude_calls) == 1 and sdk.openai_calls == []
    call = sdk.claude_calls[0]
    assert call["model"] == "claude-haiku-5-5"
    assert call["system"] == "SYSTEM TEXT"
    assert call["messages"] == [{"role": "user", "content": "USER TEXT"}]
    assert call["output_format"] is Answer
    assert call["max_tokens"] == 1234


async def test_default_max_tokens_is_8000(sdk: SdkFakes) -> None:
    sdk.claude_reply = claude_ok()
    await run_scorer_job()
    assert sdk.claude_calls[0]["max_tokens"] == 8000


async def test_claude_refusal_falls_through_to_openai_responses_parse(sdk: SdkFakes) -> None:
    sdk.claude_reply = SimpleNamespace(stop_reason="refusal", parsed_output=None,
                                       usage=SimpleNamespace(input_tokens=5, output_tokens=0))
    sdk.openai_reply = openai_ok()
    result = await run_scorer_job()
    assert result == Answer(answer="from openai")
    call = sdk.openai_calls[0]
    assert call["model"] == "gpt-6-luna"
    assert call["text_format"] is Answer
    roles = {message["role"]: message["content"] for message in call["input"]}
    assert roles == {"system": "SYSTEM TEXT", "user": "USER TEXT"}


async def test_refusal_with_a_parsed_output_is_still_a_refusal(sdk: SdkFakes) -> None:
    sdk.claude_reply = SimpleNamespace(stop_reason="refusal", parsed_output=Answer(answer="should be ignored"),
                                       usage=SimpleNamespace(input_tokens=1, output_tokens=1))
    sdk.openai_reply = openai_ok()
    assert await run_scorer_job() == Answer(answer="from openai")


async def test_a_raised_error_moves_on_to_the_second_model(sdk: SdkFakes) -> None:
    sdk.claude_reply = RuntimeError("boom")
    sdk.openai_reply = openai_ok()
    assert await run_scorer_job() == Answer(answer="from openai")


async def test_openai_returning_none_counts_as_failure(sdk: SdkFakes) -> None:
    sdk.claude_reply = RuntimeError("boom")
    sdk.openai_reply = SimpleNamespace(output_parsed=None, status="completed",
                                       usage=SimpleNamespace(input_tokens=1, output_tokens=0))
    assert await run_scorer_job() is None


async def test_all_attempts_failing_returns_none_and_logs_every_attempt(sdk: SdkFakes) -> None:
    sdk.claude_reply = RuntimeError("claude down")
    sdk.openai_reply = RuntimeError("openai down")
    assert await run_scorer_job() is None
    runs = model_runs()
    assert [run.model for run in runs] == ["claude-haiku-5-5", "gpt-6-luna"]
    assert all(run.job == "scorer" and run.prompt_version == "scorer.v1" for run in runs)
    assert all(not run.ok and run.error for run in runs)


async def test_successful_attempt_writes_a_model_run_row(sdk: SdkFakes) -> None:
    sdk.claude_reply = claude_ok()
    await run_scorer_job()
    runs = model_runs()
    assert len(runs) == 1
    run = runs[0]
    assert run.ok and run.job == "scorer" and run.model == "claude-haiku-5-5"
    assert run.output_json and "from claude" in run.output_json
    assert run.input_json
    assert run.latency_ms is not None and run.latency_ms >= 0
    assert run.input_tokens == 5 and run.output_tokens == 7


async def test_a_refusal_row_is_not_marked_ok(sdk: SdkFakes) -> None:
    sdk.claude_reply = SimpleNamespace(stop_reason="refusal", parsed_output=None,
                                       usage=SimpleNamespace(input_tokens=1, output_tokens=0))
    sdk.openai_reply = openai_ok()
    await run_scorer_job()
    runs = model_runs()
    assert [(run.model, run.ok) for run in runs] == [("claude-haiku-5-5", False), ("gpt-6-luna", True)]


async def test_provider_without_a_key_is_skipped(sdk: SdkFakes, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    get_settings.cache_clear()
    sdk.claude_reply = claude_ok()
    sdk.openai_reply = openai_ok()
    assert await run_scorer_job() == Answer(answer="from openai")
    assert sdk.claude_calls == []


async def test_no_keys_at_all_returns_none_without_calling_anyone(sdk: SdkFakes, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    monkeypatch.setenv("OPENAI_API_KEY", "")
    get_settings.cache_clear()
    assert await run_scorer_job() is None
    assert sdk.claude_calls == [] and sdk.openai_calls == []


async def test_model_order_comes_from_config(sdk: SdkFakes, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SCORER_MODELS", "gpt-6-luna,claude-haiku-5-5")
    get_settings.cache_clear()
    sdk.claude_reply = claude_ok()
    sdk.openai_reply = openai_ok()
    assert await run_scorer_job() == Answer(answer="from openai")
    assert sdk.claude_calls == []


async def test_each_job_reads_its_own_model_setting(sdk: SdkFakes) -> None:
    llm = importlib.import_module("app.agents.llm")
    sdk.openai_reply = openai_ok()
    sdk.claude_reply = claude_ok()
    await llm.run_job("planner", system="s", user="u", schema=Answer, prompt_version="planner.v1")
    assert sdk.openai_calls and sdk.openai_calls[0]["model"] == "gpt-6-astra"
    assert sdk.claude_calls == []


async def test_a_slow_first_model_is_cut_off_at_the_job_time_limit(sdk: SdkFakes) -> None:
    llm = importlib.import_module("app.agents.llm")

    async def slow() -> Any:
        await asyncio.sleep(30)
        return claude_ok("too late")

    sdk.claude_reply = slow
    sdk.openai_reply = openai_ok()
    started = time.monotonic()
    result = await llm.run_job("director", system="s", user="u", schema=Answer, prompt_version="director.v1")
    elapsed = time.monotonic() - started
    assert result == Answer(answer="from openai")
    assert 3.0 <= elapsed < 9.0, "the director's limit is 4 seconds"


# ============================================================ agents: fallbacks and shapes


async def test_build_profile_fallback_scores_zero_and_takes_consent_from_the_event_only(jobs: FakeJobs) -> None:
    from app.agents.profiler import build_profile

    yes = await build_profile("Agent: hi\nUser: yes", True)
    no = await build_profile("Agent: hi\nUser: no", False)
    unknown = await build_profile("Agent: hi", None)
    assert yes["consent_practice"] is True
    assert no["consent_practice"] is False
    assert unknown["consent_practice"] is False
    for profile in (yes, no, unknown):
        assert {item["key"]: item["score"] for item in profile["items"]} == {key: 0 for key in READINESS_KEYS}


async def test_build_profile_uses_the_model_and_clamps_scores(jobs: FakeJobs) -> None:
    from app.agents.profiler import build_profile

    scores = {"verify_first": 5, "safe_word": -3, "trusted_contact": 2, "payment_caution": 1, "under_pressure": 9}
    jobs.set("profiler", profile_payload(scores))
    profile = await build_profile("Agent: hi\nUser: I would call the bank back.", True)
    assert {item["key"]: item["score"] for item in profile["items"]} == {
        "verify_first": 2, "safe_word": 0, "trusted_contact": 2, "payment_caution": 1, "under_pressure": 2}
    assert profile["trusts_most"] == "bank"
    assert profile["said"] == "If the bank rings, I do what they say."
    assert profile["weak_spot"]
    call = jobs.calls_for("profiler")[0]
    assert "<transcript>" in call["user"] and "I would call the bank back." in call["user"]
    assert "v1" in call["prompt_version"]


async def test_improve_brief_returns_none_without_a_model_and_the_brief_with_one(jobs: FakeJobs) -> None:
    from app.agents.director import improve_brief

    template = {"caller_claim": "her son", "address_as": "Mum", "opening_line": "Mum? It's me.",
                "scenario_brief": "You broke your phone.", "ask": "a transfer today",
                "tactic_order": ["new_number", "urgency"]}
    context = {"target_name": "Sara", "difficulty": 1, "allowed_tactics": ["new_number", "urgency", "secrecy"]}
    assert await improve_brief(template, context) is None
    brief = {"caller_claim": "her son Jon", "address_as": "Mum", "opening_line": "Mum? New number.",
             "scenario_brief": "You lost your phone and borrow one.", "ask": "a small transfer today",
             "tactic_order": ["urgency", "secrecy"]}
    jobs.set("director", brief)
    improved = await improve_brief(template, context)
    assert improved is not None
    assert improved["opening_line"] == "Mum? New number."
    assert improved["tactic_order"] == ["urgency", "secrecy"]
    assert jobs.calls_for("director")


async def test_build_digest_none_without_model_and_patterns_with_one(jobs: FakeJobs) -> None:
    from app.agents.digest import build_digest

    pages = [{"url": "https://example.org/warning", "title": "Warning", "text": "Callers pose as a bank."}]
    assert await build_digest(pages) is None
    jobs.set("digest", {"patterns": [{"title": "Fake bank calls", "summary": "Callers pose as a bank.",
                                      "tactics": ["authority", "urgency"], "closest_scenario": "bank_security",
                                      "source_url": "https://example.org/warning"}]})
    digest = await build_digest(pages)
    assert digest is not None
    assert digest["patterns"][0]["title"] == "Fake bank calls"
    assert digest["patterns"][0]["closest_scenario"] == "bank_security"


# ============================================================ pipeline: practice calls


@pytest.fixture
def family(make_family: Any) -> dict[str, Any]:
    return make_family(2)


async def test_practice_rule_outcome_without_any_model_output(client: Any, family: dict[str, Any], jobs: FakeJobs) -> None:
    family_id, sara, _jon = ids_of(family)
    call_id = make_call(family_id, sara, ended_by="agent")
    add_events(call_id, PRACTICE_TURNS + [("tactic", {"key": "authority", "label": "Authority"}, 4.0),
                                          ("tactic", {"key": "urgency", "label": "Urgency"}, 8.0),
                                          ("outcome", {"outcome": "asked_safe_word"}, 10.0)])
    await run_after_call(call_id)

    result = load(Result, call_id)
    assert result is not None
    assert result.outcome == "asked_safe_word"
    assert result.seconds_to_challenge == pytest.approx(10.0, abs=0.5)
    assert json.loads(result.tactics_used_json) == ["authority", "urgency"]
    assert json.loads(result.tactics_worked_json) == []
    assert result.lesson.strip()
    assert load(Call, call_id).status == "scored"

    body = client.get(f"/api/calls/{call_id}").json()
    assert body["status"] == "scored"
    assert body["result"]["outcome"] == "asked_safe_word"
    assert body["result"]["lesson"] == result.lesson


async def test_the_fixed_lesson_depends_only_on_the_outcome(client: Any, family: dict[str, Any], jobs: FakeJobs) -> None:
    family_id, sara, jon = ids_of(family)
    lessons = []
    for target in (sara, jon):
        call_id = make_call(family_id, target, ended_by="agent")
        add_events(call_id, PRACTICE_TURNS + [("outcome", {"outcome": "agreed"}, 20.0)])
        await run_after_call(call_id)
        lessons.append(load(Result, call_id).lesson)
    assert lessons[0] == lessons[1] and lessons[0].strip()


async def test_scorer_writes_the_words_but_the_rule_keeps_the_outcome(client: Any, family: dict[str, Any],
                                                                       jobs: FakeJobs) -> None:
    family_id, sara, _ = ids_of(family)
    call_id = make_call(family_id, sara)
    add_events(call_id, PRACTICE_TURNS + [("tactic", {"key": "authority", "label": "Authority"}, 4.0),
                                          ("tactic", {"key": "urgency", "label": "Urgency"}, 6.0),
                                          ("outcome", {"outcome": "asked_safe_word"}, 10.0)])
    jobs.set("scorer", score_payload(outcome="agreed", used=["authority"], worked=["urgency"],
                                     lesson="Hang up, then ring the family number.", debrief="One. Two. Three."))
    await run_after_call(call_id)

    result = load(Result, call_id)
    assert result.outcome == "asked_safe_word", "the outcome comes from the rule, not the model"
    assert result.seconds_to_challenge == pytest.approx(10.0, abs=0.5)
    assert result.lesson == "Hang up, then ring the family number."
    assert result.debrief == "One. Two. Three."
    assert json.loads(result.tactics_worked_json) == ["urgency"]
    assert json.loads(result.tactics_used_json) == ["authority", "urgency"], "tactics_used come from tactic events"


async def test_scorer_outcome_is_used_when_no_rule_outcome_exists(client: Any, family: dict[str, Any],
                                                                   jobs: FakeJobs) -> None:
    family_id, sara, _ = ids_of(family)
    call_id = make_call(family_id, sara, ended_by="timeout")
    add_events(call_id, PRACTICE_TURNS)
    jobs.set("scorer", score_payload(outcome="hesitated", lesson="Pause, then check.", debrief="A. B. C."))
    await run_after_call(call_id)
    result = load(Result, call_id)
    assert result.outcome == "hesitated"
    assert result.seconds_to_challenge is None
    assert result.lesson == "Pause, then check."
    assert load(Call, call_id).status == "scored"


async def test_user_ended_call_is_hung_up_even_when_the_scorer_disagrees(client: Any, family: dict[str, Any],
                                                                          jobs: FakeJobs) -> None:
    family_id, sara, _ = ids_of(family)
    call_id = make_call(family_id, sara, ended_by="user", duration=12.0)
    add_events(call_id, PRACTICE_TURNS)
    jobs.set("scorer", score_payload(outcome="agreed"))
    await run_after_call(call_id)
    result = load(Result, call_id)
    assert result.outcome == "hung_up"
    assert result.seconds_to_challenge == pytest.approx(12.0, abs=0.5)
    snap = snapshots(sara)[-1]
    assert snapshot_scores(snap)["verify_first"] == 2
    assert snapshot_scores(snap)["under_pressure"] == 2


async def test_scorer_gets_the_transcript_in_tags_and_the_prompt_has_no_ids(client: Any, family: dict[str, Any],
                                                                             jobs: FakeJobs) -> None:
    family_id, sara, _ = ids_of(family)
    call_id = make_call(family_id, sara)
    add_events(call_id, PRACTICE_TURNS + [("outcome", {"outcome": "hung_up"}, 9.0)])
    jobs.set("scorer", score_payload(outcome="hung_up"))
    await run_after_call(call_id)
    scorer_call = jobs.calls_for("scorer")[0]
    user = scorer_call["user"]
    assert "<transcript>" in user
    first, second = "Hello, this is your bank's security team.", "Which bank? What is our family word?"
    assert user.index(first) < user.index(second)
    assert "v1" in scorer_call["prompt_version"]
    for text in (scorer_call["system"], jobs.calls_for("planner")[0]["system"]):
        assert call_id not in text and sara not in text and family_id not in text


async def test_jobs_run_in_order_scorer_then_planner_once_each(client: Any, family: dict[str, Any], jobs: FakeJobs) -> None:
    family_id, sara, _ = ids_of(family)
    call_id = make_call(family_id, sara)
    add_events(call_id, PRACTICE_TURNS + [("outcome", {"outcome": "hesitated"}, 30.0)])
    await run_after_call(call_id)
    assert jobs.names() == ["scorer", "planner"]


async def test_result_event_carries_lesson_and_debrief(client: Any, family: dict[str, Any], jobs: FakeJobs) -> None:
    family_id, sara, _ = ids_of(family)
    call_id = make_call(family_id, sara)
    add_events(call_id, PRACTICE_TURNS + [("outcome", {"outcome": "asked_safe_word"}, 10.0)])
    jobs.set("scorer", score_payload(lesson="Ask for the family word.", debrief="X. Y. Z."))
    await run_after_call(call_id)
    results = [event for event in stored_events(call_id) if event["type"] == "result"]
    assert len(results) == 1
    assert results[0]["data"]["lesson"] == "Ask for the family word."
    assert results[0]["data"]["debrief"] == "X. Y. Z."


async def test_result_event_also_published_with_fixed_lesson_when_models_fail(client: Any, family: dict[str, Any],
                                                                              jobs: FakeJobs) -> None:
    family_id, sara, _ = ids_of(family)
    call_id = make_call(family_id, sara)
    add_events(call_id, PRACTICE_TURNS + [("outcome", {"outcome": "agreed"}, 20.0)])
    await run_after_call(call_id)
    results = [event for event in stored_events(call_id) if event["type"] == "result"]
    assert len(results) == 1
    assert results[0]["data"]["lesson"] == load(Result, call_id).lesson


@pytest.mark.parametrize("outcome, t, expected", [
    ("asked_safe_word", 10.0, {"verify_first": 2, "safe_word": 2, "under_pressure": 2}),
    ("asked_safe_word", 45.0, {"verify_first": 2, "safe_word": 2, "under_pressure": 1}),
    ("hung_up", 45.0, {"verify_first": 2, "safe_word": 1, "under_pressure": 1}),
    ("agreed", 20.0, {"verify_first": 0, "payment_caution": 0, "under_pressure": 0, "safe_word": 1}),
    ("hesitated", 70.0, {"verify_first": 1, "under_pressure": 1, "payment_caution": 1}),
])
async def test_readiness_snapshot_after_practice(client: Any, family: dict[str, Any], jobs: FakeJobs,
                                                 outcome: str, t: float, expected: dict[str, int]) -> None:
    family_id, sara, _ = ids_of(family)
    add_snapshot(sara, {"verify_first": 0, "safe_word": 1, "trusted_contact": 1, "payment_caution": 1, "under_pressure": 0})
    call_id = make_call(family_id, sara, duration=200.0)
    add_events(call_id, PRACTICE_TURNS + [("outcome", {"outcome": outcome}, t)])
    await run_after_call(call_id)

    rows = snapshots(sara)
    assert len(rows) == 2, "one new snapshot per practice; the old one is kept"
    new = rows[-1]
    scores = snapshot_scores(new)
    assert new.source_call_id == call_id
    assert new.max == 10
    assert new.total == sum(scores.values())
    assert set(scores) == set(READINESS_KEYS)
    assert all(0 <= value <= 2 for value in scores.values())
    for key, value in expected.items():
        assert scores[key] == value, key
    assert scores["trusted_contact"] == 1


async def test_first_practice_without_a_welcome_snapshot_starts_from_zero(client: Any, family: dict[str, Any],
                                                                          jobs: FakeJobs) -> None:
    family_id, sara, _ = ids_of(family)
    call_id = make_call(family_id, sara)
    add_events(call_id, PRACTICE_TURNS + [("outcome", {"outcome": "hung_up"}, 8.0)])
    await run_after_call(call_id)
    scores = snapshot_scores(snapshots(sara)[-1])
    assert scores == {"verify_first": 2, "safe_word": 0, "trusted_contact": 0, "payment_caution": 0, "under_pressure": 2}


async def test_readiness_only_changes_for_the_called_member(client: Any, family: dict[str, Any], jobs: FakeJobs) -> None:
    family_id, sara, jon = ids_of(family)
    call_id = make_call(family_id, sara)
    add_events(call_id, PRACTICE_TURNS + [("outcome", {"outcome": "hung_up"}, 8.0)])
    await run_after_call(call_id)
    assert snapshots(jon) == []


@pytest.mark.parametrize("callback_seconds, trusted_after", [(30.0, 2), (60.0, 2), (120.0, 1), (None, 1)])
async def test_callback_seconds_are_copied_and_applied(client: Any, family: dict[str, Any], jobs: FakeJobs,
                                                        callback_seconds: float | None, trusted_after: int) -> None:
    family_id, sara, _ = ids_of(family)
    add_snapshot(sara, ALL_ONES)
    call_id = make_call(family_id, sara, callback_seconds=callback_seconds)
    add_events(call_id, PRACTICE_TURNS + [("outcome", {"outcome": "hesitated"}, 60.0)])
    await run_after_call(call_id)
    assert load(Result, call_id).callback_seconds == callback_seconds
    assert snapshot_scores(snapshots(sara)[-1])["trusted_contact"] == trusted_after


async def test_family_page_shows_before_and_now_after_a_practice(client: Any, family: dict[str, Any], jobs: FakeJobs) -> None:
    family_id, sara, _ = ids_of(family)
    add_snapshot(sara, ALL_ONES)
    call_id = make_call(family_id, sara)
    add_events(call_id, PRACTICE_TURNS + [("outcome", {"outcome": "hung_up"}, 10.0)])
    await run_after_call(call_id)
    view = next(m for m in family_view(client, family_id)["members"] if m["id"] == sara)
    assert view["readiness"]["before"] == 5
    assert view["readiness"]["now"] == 7
    assert view["readiness"]["max"] == 10


# ---- the planner after a practice

async def finish_practice(family_id: str, member_id: str, outcome: str, *, scenario: str = "bank_security",
                          difficulty: int = 1) -> str:
    call_id = make_call(family_id, member_id, scenario=scenario, difficulty=difficulty)
    add_events(call_id, PRACTICE_TURNS + [("outcome", {"outcome": outcome}, 10.0)])
    await run_after_call(call_id)
    return call_id


def next_step(member_id: str) -> dict[str, Any]:
    steps = [step for step in member_plan(member_id)["steps"] if step.get("status", "planned") != "done"]
    assert steps, "the plan should hold a next step"
    return steps[0]


@pytest.mark.parametrize("outcome", SAFE_OUTCOMES)
async def test_fallback_plan_after_a_safe_result_picks_a_new_scenario(client: Any, family: dict[str, Any],
                                                                       jobs: FakeJobs, outcome: str) -> None:
    family_id, sara, _ = ids_of(family)
    add_prior_practice(family_id, sara, "hesitated", "police", hours_ago=48)
    await finish_practice(family_id, sara, outcome, scenario="bank_security")
    step = next_step(sara)
    assert step["scenario"] in SCENARIOS
    assert step["scenario"] not in ("bank_security", "police")
    assert step["difficulty"] == 1
    assert step["why"].strip()


@pytest.mark.parametrize("outcome", ["agreed", "hesitated"])
async def test_fallback_plan_after_agreed_or_hesitated_changes_scenario_keeps_difficulty(
        client: Any, family: dict[str, Any], jobs: FakeJobs, outcome: str) -> None:
    family_id, sara, _ = ids_of(family)
    await finish_practice(family_id, sara, outcome, scenario="bank_security", difficulty=2)
    step = next_step(sara)
    assert step["scenario"] != "bank_security"
    assert step["difficulty"] == 2


async def test_two_safe_results_in_a_row_raise_the_difficulty_by_one(client: Any, family: dict[str, Any],
                                                                      jobs: FakeJobs) -> None:
    family_id, sara, _ = ids_of(family)
    add_prior_practice(family_id, sara, "asked_safe_word", "police", hours_ago=48)
    await finish_practice(family_id, sara, "hung_up", scenario="bank_security", difficulty=1)
    assert next_step(sara)["difficulty"] == 2


async def test_difficulty_never_goes_above_three(client: Any, family: dict[str, Any], jobs: FakeJobs) -> None:
    family_id, sara, _ = ids_of(family)
    add_prior_practice(family_id, sara, "asked_safe_word", "police", hours_ago=48, difficulty=3)
    await finish_practice(family_id, sara, "hung_up", scenario="bank_security", difficulty=3)
    assert next_step(sara)["difficulty"] == 3


async def test_an_unsafe_result_in_between_breaks_the_streak(client: Any, family: dict[str, Any], jobs: FakeJobs) -> None:
    family_id, sara, _ = ids_of(family)
    add_prior_practice(family_id, sara, "asked_safe_word", "police", hours_ago=72)
    add_prior_practice(family_id, sara, "agreed", "relative_new_number", hours_ago=48)
    await finish_practice(family_id, sara, "hung_up", scenario="bank_security", difficulty=1)
    assert next_step(sara)["difficulty"] == 1


async def test_fallback_plan_never_uses_a_relatives_voice_without_a_clone(client: Any, family: dict[str, Any],
                                                                           jobs: FakeJobs) -> None:
    family_id, sara, _ = ids_of(family)
    await finish_practice(family_id, sara, "hung_up")
    assert all(step.get("voice_of") is None for step in member_plan(sara)["steps"])


async def test_planner_output_is_stored_as_the_members_plan(client: Any, family: dict[str, Any], jobs: FakeJobs) -> None:
    family_id, sara, _ = ids_of(family)
    jobs.set("planner", plan_payload([sara], steps=[plan_step("police", 2)], this_week="Put the family number in favourites."))
    await finish_practice(family_id, sara, "hung_up")
    plan = member_plan(sara)
    assert plan["this_week"] == "Put the family number in favourites."
    assert plan["steps"][0]["scenario"] == "police"
    assert plan["steps"][0]["difficulty"] == 2
    view = next(m for m in family_view(client, family_id)["members"] if m["id"] == sara)
    assert view["plan"]["this_week"] == "Put the family number in favourites."
    assert view["weak_spot"] == "Trusting official-sounding callers."


async def test_planner_difficulty_is_clamped_to_the_allowed_range(client: Any, family: dict[str, Any], jobs: FakeJobs) -> None:
    family_id, sara, _ = ids_of(family)
    jobs.set("planner", plan_payload([sara], steps=[plan_step("police", 9)]))
    await finish_practice(family_id, sara, "hung_up")
    steps = member_plan(sara)["steps"]
    assert steps and all(1 <= step["difficulty"] <= 3 for step in steps)


async def test_planner_cannot_pick_a_relatives_voice_without_a_ready_clone(client: Any, family: dict[str, Any],
                                                                            jobs: FakeJobs) -> None:
    family_id, sara, _ = ids_of(family)
    jobs.set("planner", plan_payload([sara], steps=[plan_step("relative_new_number", 1, voice_of="Jon")]))
    await finish_practice(family_id, sara, "hung_up")
    steps = member_plan(sara)["steps"]
    assert steps and all(step.get("voice_of") != "Jon" for step in steps)


async def test_planner_may_pick_a_relatives_voice_with_a_ready_consented_clone(client: Any, family: dict[str, Any],
                                                                                jobs: FakeJobs) -> None:
    family_id, sara, jon = ids_of(family)
    with new_session() as session:
        member = session.get(Member, jon)
        member.voice_id, member.voice_status, member.consent_clone_at = "voice_jon", "ready", to_iso(utcnow())
        session.commit()
    jobs.set("planner", plan_payload([sara], steps=[plan_step("relative_new_number", 1, voice_of="Jon")]))
    await finish_practice(family_id, sara, "hung_up")
    assert member_plan(sara)["steps"][0]["voice_of"] == "Jon"


# ---- never let an exception escape

async def test_after_call_survives_every_model_job_raising(client: Any, family: dict[str, Any], jobs: FakeJobs) -> None:
    family_id, sara, _ = ids_of(family)
    for job in ("scorer", "planner", "profiler"):
        jobs.set(job, RuntimeError("model exploded"))
    call_id = make_call(family_id, sara)
    add_events(call_id, PRACTICE_TURNS + [("outcome", {"outcome": "hung_up"}, 10.0)])
    await run_after_call(call_id)


async def test_after_call_with_an_unknown_call_id_does_not_raise(client: Any, jobs: FakeJobs) -> None:
    await run_after_call("call_does_not_exist")


async def test_after_call_for_a_call_that_was_never_answered_does_not_raise(client: Any, family: dict[str, Any],
                                                                             jobs: FakeJobs) -> None:
    family_id, sara, _ = ids_of(family)
    call_id = make_call(family_id, sara, status="ended", ended_by="error", answered=False)
    await run_after_call(call_id)


async def test_after_call_with_no_events_and_no_model_still_finishes(client: Any, family: dict[str, Any],
                                                                      jobs: FakeJobs) -> None:
    family_id, sara, _ = ids_of(family)
    call_id = make_call(family_id, sara, ended_by="timeout")
    await run_after_call(call_id)
    result = load(Result, call_id)
    if result is not None:
        assert result.outcome in OUTCOMES and result.lesson.strip()


async def test_running_after_call_twice_keeps_a_single_result(client: Any, family: dict[str, Any], jobs: FakeJobs) -> None:
    family_id, sara, _ = ids_of(family)
    call_id = make_call(family_id, sara)
    add_events(call_id, PRACTICE_TURNS + [("outcome", {"outcome": "hung_up"}, 10.0)])
    await run_after_call(call_id)
    await run_after_call(call_id)
    with new_session() as session:
        assert len(list(session.scalars(select(Result).where(Result.call_id == call_id)))) == 1


# ============================================================ pipeline: family line calls


async def test_family_line_call_is_only_marked_scored(client: Any, family: dict[str, Any], jobs: FakeJobs) -> None:
    family_id, sara, _ = ids_of(family)
    practice_id = make_call(family_id, sara, status="scored")
    line_id = make_call(family_id, sara, kind="family_line", status="ended", scenario=None)
    with new_session() as session:
        session.get(Call, line_id).parent_call_id = practice_id
        session.commit()
    add_events(line_id, turns(("agent", "Family line."), ("user", "Was that a practice?")))
    await run_after_call(line_id)
    assert load(Call, line_id).status == "scored"
    assert jobs.calls == []
    assert load(Result, line_id) is None
    assert snapshots(sara) == []


# ============================================================ pipeline: welcome calls


WELCOME_TURNS = turns(("agent", "Hi Sara, this is Callback. Have you got two minutes?"),
                      ("user", "Sure."),
                      ("agent", "Are you happy to get a practice call now and then?"),
                      ("user", "Yes, that is fine."),
                      ("agent", "If the bank rings, what do you do?"),
                      ("user", "I do what they say."))


async def welcome_call(family_id: str, member_id: str, consent_event: bool | None = True) -> str:
    call_id = make_call(family_id, member_id, kind="welcome", ended_by="agent", scenario=None, duration=200.0)
    items = list(WELCOME_TURNS)
    if consent_event is not None:
        items.append(("consent", {"given": consent_event}, 12.0))
    add_events(call_id, items)
    await run_after_call(call_id)
    return call_id


async def test_welcome_with_model_output(client: Any, make_family: Any, jobs: FakeJobs) -> None:
    family = make_family(2, consent=False)
    family_id, sara, jon = ids_of(family)
    scores = {"verify_first": 0, "safe_word": 1, "trusted_contact": 2, "payment_caution": 1, "under_pressure": 0}
    jobs.set("profiler", profile_payload(scores, trusts="bank"))
    jobs.set("planner", plan_payload([sara, jon], steps=[plan_step("bank_security", 1)], this_week="Save the family number."))
    call_id = await welcome_call(family_id, sara)

    assert load(Call, call_id).status == "scored"
    assert jobs.names() == ["profiler", "planner"], "profiler first, then one planner job for the whole family"
    profile = json.loads(load(Member, sara).profile_json)
    assert profile["trusts_most"] == "bank"
    assert profile["said"] == "If the bank rings, I do what they say."
    first = snapshots(sara)
    assert len(first) == 1 and first[0].source_call_id == call_id
    assert snapshot_scores(first[0]) == scores
    assert first[0].total == 4 and first[0].max == 10
    for member_id in (sara, jon):
        assert member_plan(member_id)["this_week"] == "Save the family number."
    assert load(Result, call_id) is None

    view = next(m for m in family_view(client, family_id)["members"] if m["id"] == sara)
    assert view["readiness"]["before"] == 4 and view["readiness"]["now"] == 4
    assert view["said"] == "If the bank rings, I do what they say."


async def test_welcome_clamps_profile_scores(client: Any, family: dict[str, Any], jobs: FakeJobs) -> None:
    family_id, sara, jon = ids_of(family)
    jobs.set("profiler", profile_payload({"verify_first": 7, "safe_word": -2, "trusted_contact": 1}))
    await welcome_call(family_id, sara)
    scores = snapshot_scores(snapshots(sara)[0])
    assert scores["verify_first"] == 2 and scores["safe_word"] == 0 and scores["trusted_contact"] == 1


async def test_welcome_fallback_when_every_model_fails(client: Any, make_family: Any, jobs: FakeJobs) -> None:
    family = make_family(2, consent=False)
    family_id, sara, jon = ids_of(family)
    call_id = await welcome_call(family_id, sara, consent_event=True)
    assert load(Call, call_id).status == "scored"
    scores = snapshot_scores(snapshots(sara)[0])
    assert scores == {key: 0 for key in READINESS_KEYS}
    assert load(Member, sara).consent_practice_at is not None, "consent comes from the event when the profiler fails"
    plan = member_plan(sara)
    assert plan["steps"], "the fallback rule still gives a first step"
    assert plan["steps"][0]["scenario"] == "relative_new_number"
    assert plan["steps"][0]["difficulty"] == 1
    view = next(m for m in family_view(client, family_id)["members"] if m["id"] == sara)
    assert view["readiness"]["before"] == 0 and view["readiness"]["max"] == 10


@pytest.mark.parametrize("trusts, scenario", [("bank", "bank_security"), ("police", "police"),
                                              ("family", "relative_new_number"), ("unknown", "relative_new_number")])
async def test_fallback_first_scenario_matches_who_the_person_trusts(client: Any, family: dict[str, Any],
                                                                      jobs: FakeJobs, trusts: str, scenario: str) -> None:
    family_id, sara, _ = ids_of(family)
    jobs.set("profiler", profile_payload(trusts=trusts))
    await welcome_call(family_id, sara)
    step = member_plan(sara)["steps"][0]
    assert step["scenario"] == scenario
    assert step["difficulty"] == 1
    assert all(step.get("voice_of") is None for step in member_plan(sara)["steps"])


async def test_consent_event_yes_sets_consent_and_writes_a_welcome_call_row(client: Any, make_family: Any,
                                                                             jobs: FakeJobs) -> None:
    family = make_family(2, consent=False)
    family_id, sara, _ = ids_of(family)
    assert load(Member, sara).consent_practice_at is None
    call_id = await welcome_call(family_id, sara, consent_event=True)
    assert load(Member, sara).consent_practice_at is not None
    with new_session() as session:
        rows = list(session.scalars(select(Consent).where(Consent.member_id == sara, Consent.kind == "practice")))
    assert [(row.source, row.call_id) for row in rows] == [("welcome_call", call_id)]


async def test_spoken_yes_is_a_second_consent_row_after_the_sign_up_tick(client: Any, family: dict[str, Any],
                                                                         jobs: FakeJobs) -> None:
    family_id, sara, _ = ids_of(family)
    await welcome_call(family_id, sara, consent_event=True)
    with new_session() as session:
        sources = sorted(row.source for row in session.scalars(
            select(Consent).where(Consent.member_id == sara, Consent.kind == "practice")))
    assert sources == ["manual", "welcome_call"]


@pytest.mark.parametrize("event", [False, None])
async def test_no_clear_yes_means_no_consent(client: Any, make_family: Any, jobs: FakeJobs, event: bool | None) -> None:
    family = make_family(2, consent=False)
    family_id, sara, _ = ids_of(family)
    await welcome_call(family_id, sara, consent_event=event)
    assert load(Member, sara).consent_practice_at is None
    with new_session() as session:
        assert list(session.scalars(select(Consent).where(Consent.member_id == sara))) == []


async def test_a_spoken_no_beats_a_model_that_says_yes(client: Any, make_family: Any, jobs: FakeJobs) -> None:
    family = make_family(2, consent=False)
    family_id, sara, _ = ids_of(family)
    jobs.set("profiler", profile_payload(consent=True))
    await welcome_call(family_id, sara, consent_event=False)
    assert load(Member, sara).consent_practice_at is None


async def test_planner_output_for_unknown_members_is_ignored(client: Any, family: dict[str, Any], jobs: FakeJobs) -> None:
    family_id, sara, jon = ids_of(family)
    jobs.set("profiler", profile_payload())
    jobs.set("planner", plan_payload(["mem_nobody", sara]))
    await welcome_call(family_id, sara)
    assert member_plan(sara)["this_week"]


# ============================================================ after the call: saving ElevenLabs' transcript


def use_real_elevenlabs_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FAKE_ELEVENLABS", "false")
    monkeypatch.setenv("ELEVENLABS_API_KEY", "xi-test")
    get_settings.cache_clear()


def patch_get_conversation(monkeypatch: pytest.MonkeyPatch, fake: Any) -> None:
    elevenlabs = importlib.import_module("app.services.elevenlabs")
    monkeypatch.setattr(elevenlabs, "get_conversation", fake)
    pipeline = importlib.import_module("app.services.pipeline")
    if hasattr(pipeline, "get_conversation"):
        monkeypatch.setattr(pipeline, "get_conversation", fake)


async def wait_for_file(path: Path, seconds: float) -> bool:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if path.exists():
            return True
        await asyncio.sleep(0.2)
    return path.exists()


async def test_transcript_is_polled_and_saved_without_delaying_scoring(client: Any, family: dict[str, Any], jobs: FakeJobs,
                                                                        monkeypatch: pytest.MonkeyPatch) -> None:
    use_real_elevenlabs_mode(monkeypatch)
    answers = [{"status": "processing"},
               {"status": "done", "transcript": [{"role": "agent", "message": "unique-transcript-marker", "time_in_call_secs": 1}]}]
    asked: list[str] = []

    async def fake_get_conversation(conversation_id: str) -> dict[str, Any]:
        asked.append(conversation_id)
        return answers.pop(0) if len(answers) > 1 else answers[0]

    patch_get_conversation(monkeypatch, fake_get_conversation)
    family_id, sara, _ = ids_of(family)
    call_id = make_call(family_id, sara, conversation_id="conv_123")
    add_events(call_id, PRACTICE_TURNS + [("outcome", {"outcome": "hung_up"}, 10.0)])
    await run_after_call(call_id)

    path = get_settings().media_path / "transcripts" / f"{call_id}.json"
    assert load(Call, call_id).status == "scored", "scoring does not wait for the transcript"
    assert not path.exists(), "the first answer was still 'processing', so nothing can be saved yet"
    assert await wait_for_file(path, 8.0), "the transcript should be saved once ElevenLabs reports done"
    assert "unique-transcript-marker" in path.read_text()
    json.loads(path.read_text())
    assert set(asked) == {"conv_123"}
    assert len(asked) >= 2


async def test_transcript_errors_are_skipped_quietly(client: Any, family: dict[str, Any], jobs: FakeJobs,
                                                     monkeypatch: pytest.MonkeyPatch) -> None:
    use_real_elevenlabs_mode(monkeypatch)

    async def failing(conversation_id: str) -> dict[str, Any]:
        raise RuntimeError("elevenlabs is down")

    patch_get_conversation(monkeypatch, failing)
    family_id, sara, _ = ids_of(family)
    call_id = make_call(family_id, sara, conversation_id="conv_err")
    add_events(call_id, PRACTICE_TURNS + [("outcome", {"outcome": "hung_up"}, 10.0)])
    await run_after_call(call_id)
    await asyncio.sleep(0.5)
    assert load(Call, call_id).status == "scored"
    assert not (get_settings().media_path / "transcripts" / f"{call_id}.json").exists()


async def test_fake_mode_skips_the_transcript_fetch(client: Any, family: dict[str, Any], jobs: FakeJobs,
                                                    monkeypatch: pytest.MonkeyPatch) -> None:
    assert get_settings().fake_elevenlabs
    asked: list[str] = []

    async def spy(conversation_id: str) -> dict[str, Any]:
        asked.append(conversation_id)
        return {"status": "done", "transcript": []}

    patch_get_conversation(monkeypatch, spy)
    family_id, sara, _ = ids_of(family)
    call_id = make_call(family_id, sara, conversation_id="conv_fake")
    add_events(call_id, PRACTICE_TURNS + [("outcome", {"outcome": "hung_up"}, 10.0)])
    await run_after_call(call_id)
    await asyncio.sleep(0.3)
    assert asked == []
    assert not (get_settings().media_path / "transcripts" / f"{call_id}.json").exists()


# ============================================================ end to end through the API


def start_practice_over_http(client: Any, family: dict[str, Any]) -> str:
    _, sara, _ = ids_of(family)
    assert client.get(f"/api/members/{sara}/phone-state").status_code == 200
    created = client.post("/api/practice-calls", json={"target_member_id": sara, "scenario": "bank_security",
                                                        "difficulty": 1})
    assert created.status_code == 201, created.text
    call_id = created.json()["call_id"]
    assert client.post(f"/api/calls/{call_id}/answer").status_code == 200
    batch = {"events": [
        {"type": "turn", "speaker": "agent", "text": "This is your bank's security team."},
        {"type": "tactic", "key": "authority"},
        {"type": "turn", "speaker": "user", "text": "What is our family word?"},
        {"type": "outcome", "outcome": "asked_safe_word"},
        {"type": "revealed"},
    ]}
    assert client.post(f"/api/calls/{call_id}/events", json=batch).status_code == 200
    assert client.post(f"/api/calls/{call_id}/end", json={"ended_by": "agent"}).status_code == 200
    return call_id


def wait_until_scored(client: Any, call_id: str, seconds: float = 10.0) -> dict[str, Any]:
    deadline = time.monotonic() + seconds
    body: dict[str, Any] = {}
    while time.monotonic() < deadline:
        body = client.get(f"/api/calls/{call_id}").json()
        if body["status"] == "scored":
            return body
        time.sleep(0.2)
    pytest.fail(f"the call was never scored, last status: {body.get('status')}")


def test_end_to_end_with_no_api_keys_uses_the_fallbacks(client: Any, family: dict[str, Any]) -> None:
    call_id = start_practice_over_http(client, family)
    body = wait_until_scored(client, call_id)
    result = body["result"]
    assert result["outcome"] == "asked_safe_word"
    assert result["lesson"].strip()
    assert result["tactics_used"] == ["authority"]
    assert result["seconds_to_challenge"] is not None and result["seconds_to_challenge"] >= 0
    assert any(event["type"] == "result" for event in stored_events(call_id))
    _, sara, _ = ids_of(family)
    view = next(m for m in family_view(client, family["family_id"])["members"] if m["id"] == sara)
    assert view["readiness"]["now"] >= 6
    assert view["plan"] is not None and view["plan"]["steps"]


def test_end_to_end_with_scorer_output(client: Any, family: dict[str, Any], jobs: FakeJobs) -> None:
    jobs.set("scorer", score_payload(outcome="asked_safe_word", used=["authority"], worked=[],
                                     lesson="You asked for the family word, so keep doing that.",
                                     debrief="The caller posed as a bank. You asked the family word. Keep it up."))
    call_id = start_practice_over_http(client, family)
    result = wait_until_scored(client, call_id)["result"]
    assert result["lesson"] == "You asked for the family word, so keep doing that."
    assert result["debrief"] == "The caller posed as a bank. You asked the family word. Keep it up."


# ============================================================ firecrawl


async def test_firecrawl_without_a_key_returns_the_builtin_list_and_makes_no_request() -> None:
    from app.services.firecrawl import fetch_warnings

    assert get_settings().firecrawl_api_key == ""
    with respx.mock(assert_all_called=False) as router:
        pages = await fetch_warnings(["https://example.org/a", "https://example.org/b"])
        assert router.calls.call_count == 0
    assert isinstance(pages, list) and pages
    assert all(isinstance(page, dict) for page in pages)


@pytest.mark.parametrize("failure", [httpx.Response(500, json={"error": "boom"}), httpx.ConnectError("no route")])
async def test_firecrawl_errors_fall_back_to_the_builtin_list(monkeypatch: pytest.MonkeyPatch, failure: Any) -> None:
    from app.services.firecrawl import fetch_warnings

    monkeypatch.setenv("FIRECRAWL_API_KEY", "fc-test")
    get_settings.cache_clear()
    with respx.mock(assert_all_called=False) as router:
        route = router.route()
        if isinstance(failure, Exception):
            route.mock(side_effect=failure)
        else:
            route.mock(return_value=failure)
        pages = await fetch_warnings(["https://example.org/a"])
    assert isinstance(pages, list) and pages


# ============================================================ the weekly run


def iso_week_now() -> str:
    year, week, _ = utcnow().isocalendar()
    return f"{year}-W{week:02d}"


def weekly(client: Any, family_id: str) -> dict[str, Any]:
    response = client.post(f"/api/families/{family_id}/weekly-run")
    assert response.status_code == 200, response.text
    return response.json()


def test_weekly_run_unknown_family_is_404(client: Any) -> None:
    response = client.post("/api/families/fam_nope/weekly-run")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_weekly_run_without_keys_uses_the_builtin_digest(client: Any, family: dict[str, Any]) -> None:
    body = weekly(client, family["family_id"])
    digest = body["digest"]
    assert re.fullmatch(r"\d{4}-W\d{2}", digest["week"])
    assert digest["week"] == iso_week_now()
    assert len(digest["patterns"]) >= 1
    for pattern in digest["patterns"]:
        assert pattern["title"].strip() and pattern["summary"].strip()
        assert pattern["closest_scenario"] in SCENARIOS
        assert pattern["tactics"] and set(pattern["tactics"]) <= set(TACTICS)
    with new_session() as session:
        assert len(list(session.scalars(select(Digest)))) == 1


def test_weekly_run_uses_the_digest_job_output(client: Any, family: dict[str, Any], jobs: FakeJobs) -> None:
    jobs.set("digest", {"patterns": [{"title": "Voice message from a relative", "summary": "A caller sounds like family.",
                                      "tactics": ["new_number", "urgency"], "closest_scenario": "relative_new_number",
                                      "source_url": "https://example.org/relative"}]})
    digest = weekly(client, family["family_id"])["digest"]
    assert [pattern["title"] for pattern in digest["patterns"]] == ["Voice message from a relative"]
    assert digest["patterns"][0]["source_url"] == "https://example.org/relative"


def test_one_digest_per_week_shared_by_all_families(client: Any, make_family: Any, jobs: FakeJobs) -> None:
    jobs.set("digest", {"patterns": [{"title": "Shared pattern", "summary": "One pattern.", "tactics": ["urgency"],
                                      "closest_scenario": "police", "source_url": "https://example.org/p"}]})
    first, second = make_family(2), make_family(2)
    one = weekly(client, first["family_id"])["digest"]
    two = weekly(client, second["family_id"])["digest"]
    assert one == two
    assert len(jobs.calls_for("digest")) == 1
    with new_session() as session:
        assert len(list(session.scalars(select(Digest)))) == 1


def test_running_the_same_family_twice_keeps_one_digest_row(client: Any, family: dict[str, Any]) -> None:
    weekly(client, family["family_id"])
    weekly(client, family["family_id"])
    with new_session() as session:
        assert len(list(session.scalars(select(Digest)))) == 1


def seed_plans(family: dict[str, Any]) -> None:
    for member in family["members"]:
        plan = {"member_id": member["id"], "weak_spot": "Trusting official callers.", "this_week": "Save the family number.",
                "steps": [{"when": "today", "scenario": "bank_security", "difficulty": 1, "voice_of": None,
                           "why": "You said you do what the bank says.", "status": "planned"}]}
        with new_session() as session:
            session.get(Member, member["id"]).plan_json = json.dumps(plan)
            session.commit()


def test_weekly_run_does_one_action_per_member_and_stores_messages(client: Any, family: dict[str, Any]) -> None:
    seed_plans(family)
    body = weekly(client, family["family_id"])
    actions = body["actions"]
    assert sorted(action["member_id"] for action in actions) == sorted(m["id"] for m in family["members"])
    names = {m["id"]: m["name"] for m in family["members"]}
    for action in actions:
        assert action["kind"] in ("message", "practice", "reminder")
        assert action["member_name"] == names[action["member_id"]]
        assert action["text"].strip()
        if action["kind"] in ("message", "reminder"):
            expected_kind = "weekly" if action["kind"] == "message" else "reminder"
            with new_session() as session:
                rows = list(session.scalars(select(Message).where(Message.member_id == action["member_id"])))
            assert any(row.kind == expected_kind and row.text == action["text"] for row in rows)
            state = client.get(f"/api/members/{action['member_id']}/phone-state").json()
            assert any(message["text"] == action["text"] for message in state["messages"])
            assert action["call_id"] is None
        else:
            call = load(Call, action["call_id"])
            assert call is not None and call.kind == "practice"
            assert call.target_member_id == action["member_id"]
            assert call.status == "scheduled" and call.scheduled_for
            assert call.scenario in SCENARIOS


def test_weekly_practices_are_created_through_create_practice_without_the_phone_check(
        client: Any, family: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    seed_plans(family)
    recorded: list[dict[str, Any]] = []

    async def fake_create_practice(db: Any, target_member_id: str, voice_member_id: str | None, scenario: str,
                                   difficulty: int, delay_seconds: int = 0, check_phone_online: bool = True) -> Call:
        recorded.append({"target": target_member_id, "voice": voice_member_id, "scenario": scenario,
                         "difficulty": difficulty, "delay": delay_seconds, "check": check_phone_online})
        call = Call(id=new_call_id(), family_id=family["family_id"], kind="practice", target_member_id=target_member_id,
                    voice_member_id=voice_member_id, scenario=scenario, difficulty=difficulty, status="scheduled",
                    scheduled_for=to_iso(utcnow() + timedelta(seconds=max(delay_seconds, 1))),
                    created_at=to_iso(utcnow()))
        db.add(call)
        db.commit()
        return call

    calls_module = importlib.import_module("app.routers.calls")
    weekly_module = importlib.import_module("app.routers.weekly")
    monkeypatch.setattr(calls_module, "create_practice", fake_create_practice)
    monkeypatch.setattr(weekly_module, "create_practice", fake_create_practice, raising=False)

    body = weekly(client, family["family_id"])
    practices = [action for action in body["actions"] if action["kind"] == "practice"]
    assert len(recorded) == len(practices)
    member_ids = {m["id"] for m in family["members"]}
    for call in recorded:
        assert call["check"] is False
        assert call["target"] in member_ids
        assert call["scenario"] in SCENARIOS and 1 <= call["difficulty"] <= 3
    for action in practices:
        assert action["call_id"] and load(Call, action["call_id"]).status == "scheduled"


def test_weekly_practice_that_is_refused_becomes_a_reminder_message(
        client: Any, family: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    seed_plans(family)

    async def refusing(*args: Any, **kwargs: Any) -> Call:
        raise ApiError(409, "busy", "This person is already on a call.")

    calls_module = importlib.import_module("app.routers.calls")
    weekly_module = importlib.import_module("app.routers.weekly")
    monkeypatch.setattr(calls_module, "create_practice", refusing)
    monkeypatch.setattr(weekly_module, "create_practice", refusing, raising=False)

    body = weekly(client, family["family_id"])
    assert len(body["actions"]) == len(family["members"])
    assert all(action["kind"] != "practice" for action in body["actions"])
    with new_session() as session:
        assert list(session.scalars(select(Call).where(Call.kind == "practice"))) == []
        stored = list(session.scalars(select(Message)))
    for action in body["actions"]:
        assert any(row.member_id == action["member_id"] and row.text == action["text"] for row in stored)


def test_weekly_run_does_not_create_practice_calls_for_members_who_did_not_consent(client: Any, make_family: Any) -> None:
    family = make_family(2, consent=False)
    seed_plans(family)
    body = weekly(client, family["family_id"])
    assert all(action["kind"] != "practice" for action in body["actions"])
    with new_session() as session:
        assert list(session.scalars(select(Call).where(Call.kind == "practice"))) == []


def test_weekly_run_skips_practice_for_a_member_who_opted_out(client: Any, family: dict[str, Any]) -> None:
    seed_plans(family)
    _, sara, _ = ids_of(family)
    with new_session() as session:
        session.get(Member, sara).opted_out_at = to_iso(utcnow())
        session.commit()
    body = weekly(client, family["family_id"])
    assert all(not (action["member_id"] == sara and action["kind"] == "practice") for action in body["actions"])
    with new_session() as session:
        assert list(session.scalars(select(Call).where(Call.target_member_id == sara))) == []

"""The live risk check: the job (agents/risk.py), its trigger and its events
(services/live_risk.py, POST /api/calls/{id}/events). No network: llm.run_job
is replaced, or there are no keys and the fallback answers.

The test suite switches the check off (conftest); every test here switches it
back on."""

import asyncio
import json
import time
from collections.abc import Iterator
from contextlib import aclosing
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel

from app import events, schemas
from app.agents import llm, risk
from app.agents.shapes import RiskCheck
from app.config import get_settings
from app.db import new_session, now_iso
from app.ids import new_call_id, new_family_id, new_member_id
from app.models import Call, Family, Member
from app.routers import streams
from app.services import live_risk

FIXTURES = json.loads((Path(__file__).parent / "fixtures" / "practice_transcripts.json").read_text(encoding="utf-8"))
SOFT = ("new_number", "urgency", "authority", "emotional_appeal", "small_ask_first")


@pytest.fixture(autouse=True)
def risk_on(test_settings, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("RISK_CHECK_ENABLED", "true")
    get_settings.cache_clear()
    live_risk._running.clear()
    live_risk._again.clear()
    yield
    live_risk._running.clear()
    live_risk._again.clear()


class FakeRunJob:
    """Replaces llm.run_job: answers from a queue; an asyncio.Event in the
    queue makes that call wait until it is set."""

    def __init__(self, *answers: Any) -> None:
        self.answers = list(answers)
        self.calls: list[dict[str, Any]] = []

    async def __call__(self, job: str, *, system: str, user: str, schema: type[BaseModel],
                       prompt_version: str, max_tokens: int = 8000) -> BaseModel | None:
        self.calls.append({"job": job, "user": user, "system": system, "prompt_version": prompt_version})
        answer = self.answers.pop(0) if self.answers else None
        if isinstance(answer, tuple):  # (gate, answer): wait for the gate first
            gate, answer = answer
            await gate.wait()
        if isinstance(answer, Exception):
            raise answer
        return schema.model_validate(answer) if isinstance(answer, dict) else answer


def make_call(kind: str = "practice", status: str = "in_progress") -> str:
    with new_session() as db:
        family = Family(id=new_family_id(), name="The Kovacs", safe_word_set=True, created_at=now_iso())
        member = Member(id=new_member_id(), family_id=family.id, name="Sara", relationship="mother",
                        created_at=now_iso())
        call = Call(id=new_call_id(), family_id=family.id, kind=kind, target_member_id=member.id,
                    status=status, answered_at=now_iso(), created_at=now_iso())
        for row in (family, member, call):  # one at a time: the tables have no relationships to order them
            db.add(row)
            db.flush()
        db.commit()
        return call.id


def caller(text: str) -> dict[str, str]:
    return {"speaker": "agent", "text": text}


def person(text: str) -> dict[str, str]:
    return {"speaker": "user", "text": text}


def risk_events(call_id: str) -> list[dict[str, Any]]:
    return [event for event in events.list_events(call_id) if event["type"] == "risk"]


def wait_for_risk(call_id: str, count: int = 1, seconds: float = 3.0) -> list[dict[str, Any]]:
    deadline = time.monotonic() + seconds
    while len(risk_events(call_id)) < count and time.monotonic() < deadline:
        time.sleep(0.02)
    return risk_events(call_id)


def read_blocks(lines: Iterator[str], count: int) -> list[dict[str, str]]:
    """The next `count` server-sent blocks (events or comments), each as {field: value}."""
    blocks: list[dict[str, str]] = []
    block: dict[str, str] = {}
    for line in lines:
        if line == "":
            blocks.append(block)
            block = {}
            if len(blocks) == count:
                return blocks
        elif line.startswith(":"):
            block["comment"] = line
        else:
            field, _, value = line.partition(":")
            block[field] = value.lstrip(" ")
    return blocks


async def wait_until_idle(call_id: str, seconds: float = 3.0) -> None:
    deadline = time.monotonic() + seconds
    while live_risk.is_running(call_id) and time.monotonic() < deadline:
        await asyncio.sleep(0.01)
    assert not live_risk.is_running(call_id)


# ---------------------------------------------------------------- the rule: signals to level


def test_every_signal_has_a_label_and_the_tactics_are_signals() -> None:
    assert set(schemas.RISK_SIGNAL_LABELS) == set(schemas.RISK_SIGNALS)
    assert set(schemas.TACTICS) <= set(schemas.RISK_SIGNALS)
    assert set(risk.RED_SIGNALS) | set(SOFT) == set(schemas.RISK_SIGNALS)
    assert set(risk.REASON_ORDER) == set(risk.REASON_PHRASES) == set(schemas.RISK_SIGNALS)


def test_no_signals_is_green_soft_pressure_is_yellow_money_secrecy_code_is_red() -> None:
    assert risk.level_for([]) == "green"
    for key in SOFT:
        assert risk.level_for([key]) == "yellow", key
    assert risk.level_for(list(SOFT)) == "yellow"
    for key in ("money_request", "unusual_payment", "asks_for_code", "refuses_callback", "secrecy", "isolation"):
        assert risk.level_for([key]) == "red", key
        assert risk.level_for(["urgency", key]) == "red", key
    assert risk.level_for(["not_a_signal"]) == "green"


def test_the_level_never_goes_down_and_signals_are_kept() -> None:
    first = risk.combine(None, ["urgency"], "Rushes you", "risk.v1", 0)
    assert (first["level"], first["signals"], first["reason"]) == ("yellow", ["urgency"], "Rushes you")
    second = risk.combine(first, ["money_request", "urgency"], "Asks for money today", "risk.v1", 2)
    assert second["level"] == "red"
    assert second["signals"] == ["urgency", "money_request"]  # first seen first
    assert second["labels"] == ["Urgency", "Asks for money"]
    # A later check that sees less does not lower the light or drop a signal,
    # and its weaker reason does not replace the one that explains red.
    third = risk.combine(second, [], "Nothing worrying yet", "risk.v1", 4)
    assert (third["level"], third["signals"], third["reason"]) == ("red", ["urgency", "money_request"],
                                                                   "Asks for money today")
    fourth = risk.combine(third, ["new_number"], "New number", "fallback", 6)
    assert fourth["level"] == "red" and fourth["reason"] == "Asks for money today"
    assert fourth["signals"] == ["urgency", "money_request", "new_number"]
    assert (fourth["turn_index"], fourth["source"]) == (6, "fallback")


def test_a_reason_is_always_there_and_fits_the_screen() -> None:
    assert risk.combine(None, [], None, "risk.v1", 0)["reason"] == risk.GREEN_REASON
    assert risk.combine(None, [], "Seems pushy", "risk.v1", 0)["reason"] == risk.GREEN_REASON
    assert risk.combine(None, ["secrecy"], None, "risk.v1", 0)["reason"] == "Caller wants it kept secret"
    assert risk.combine(None, ["secrecy"], "Nothing worrying yet", "risk.v1", 0)["reason"] != risk.GREEN_REASON
    assert risk.clean_reason(' "Asks for money  and secrecy." ') == "Asks for money and secrecy"
    assert risk.clean_reason("word " * 30) is None
    assert risk.clean_reason("") is None
    assert risk.fallback_reason(["urgency", "asks_for_code", "new_number"]) == "Caller asks for a code and rushes you"


# ---------------------------------------------------------------- the fallback in code


@pytest.mark.parametrize(("text", "expected"), [
    ("Mum? It's me. I dropped my phone, so this is a new number.", {"new_number"}),
    ("Could you send me four hundred euros today?", {"money_request", "urgency"}),
    ("Please don't tell Dad, he'll only fuss.", {"secrecy"}),
    ("Can you read me the code we've just texted you?", {"asks_for_code"}),
    ("Don't hang up, there's no time for that.", {"refuses_callback", "urgency"}),
    ("Buy two gift cards at the shop and send me the numbers.", {"unusual_payment", "money_request"}),
    ("This is the fraud team at your bank.", {"authority"}),
    ("Do not contact your bank, they may be involved.", {"isolation"}),
    ("It's been an awful morning, I really need your help.", {"emotional_appeal"}),
    ("I just need to confirm it's you, it takes a second.", {"small_ask_first"}),
    ("Hello, how are you keeping?", set()),
])
def test_the_fallback_finds_signals_by_keyword(text: str, expected: set[str]) -> None:
    assert set(risk.fallback_signals([caller(text)])) == expected


def test_the_fallback_reads_only_the_callers_lines() -> None:
    turns = [caller("Hello, it's me."), person("Should I send money today? Is there a code?")]
    result = risk.fallback_check(turns)
    assert result == {"level": "green", "signals": [], "labels": [], "reason": risk.GREEN_REASON,
                      "turn_index": 0, "source": "fallback"}


def test_the_fallback_lights_every_written_practice_call() -> None:
    """Over the ten fixture calls, turn by turn up to the reveal: the light
    never goes down, ends yellow or red, and finds a tactic the agent marked."""
    for case in FIXTURES:
        previous: dict[str, Any] | None = None
        levels: list[str] = []
        for index, turn in enumerate(case["turns"]):
            if "this was a callback practice call" in turn["text"].lower():
                break
            if turn["speaker"] == "agent":
                previous = risk.fallback_check(case["turns"][:index + 1], previous)
                levels.append(previous["level"])
        assert previous is not None, case["id"]
        ranks = [schemas.RISK_LEVELS.index(level) for level in levels]
        assert ranks == sorted(ranks), case["id"]
        assert previous["level"] in ("yellow", "red"), case["id"]
        assert set(previous["signals"]) & set(case["tactics_marked"]), case["id"]


# ---------------------------------------------------------------- the model job


async def test_the_model_names_signals_and_code_sets_the_level(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeRunJob({"signals": ["urgency", "secrecy"], "reason": "Rushes you, wants secrecy"})
    monkeypatch.setattr(llm, "run_job", fake)
    turns = [caller("It has to be today."), person("Why?"), caller("Just don't tell Dad.")]
    result = await risk.check_risk(turns)
    assert result == {"level": "red", "signals": ["urgency", "secrecy"], "labels": ["Urgency", "Secrecy"],
                      "reason": "Rushes you, wants secrecy", "turn_index": 2, "source": risk.PROMPT_VERSION}
    call = fake.calls[0]
    assert call["job"] == "risk" and call["prompt_version"] == "risk.v1"
    assert call["user"] == ("<transcript>\nCaller: It has to be today.\nPerson: Why?\n"
                            "Caller: Just don't tell Dad.\n</transcript>")
    assert call["system"] == llm.load_prompt("risk")


async def test_no_answer_an_error_or_a_slow_model_means_the_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    turns = [caller("Could you send me the money today?")]
    expected = {"level": "red", "signals": ["urgency", "money_request"], "source": "fallback"}
    monkeypatch.setattr(risk, "TOTAL_SECONDS", 0.05)
    never = asyncio.Event()
    for answer in (None, RuntimeError("boom"), (never, None)):
        monkeypatch.setattr(llm, "run_job", FakeRunJob(answer))
        result = await risk.check_risk(turns)
        assert {key: result[key] for key in expected} == expected, answer


async def test_without_keys_no_model_is_called_and_the_fallback_answers(monkeypatch: pytest.MonkeyPatch) -> None:
    async def never(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("no model should be called without keys")

    monkeypatch.setattr(llm, "_call", never)
    result = await risk.check_risk([caller("Please read out the code we sent you.")])
    assert (result["level"], result["source"]) == ("red", "fallback")
    assert "asks_for_code" in result["signals"]


def test_the_risk_job_is_a_fast_job() -> None:
    assert "risk" in llm.JOB_SECONDS and llm.JOB_SECONDS["risk"] <= 4
    assert llm.CLAUDE_EFFORT["risk"] == "low"
    assert llm.job_models("risk") == ["claude-haiku-5-5", "gpt-6-luna"]


# ---------------------------------------------------------------- the background check


def test_turns_to_check_stop_at_the_outcome_and_find_the_last_check() -> None:
    stored = [
        {"type": "call.status", "data": {"status": "in_progress"}},
        {"type": "turn", "data": caller("Mum?")},
        {"type": "risk", "data": {"level": "yellow", "turn_index": 0}},
        {"type": "tactic", "data": {"key": "urgency"}},
        {"type": "turn", "data": person("Yes?")},
        {"type": "risk", "data": {"level": "red", "turn_index": 1}},
        {"type": "outcome", "data": {"outcome": "hung_up"}},
        {"type": "turn", "data": caller("This was a practice call.")},
    ]
    turns, previous = live_risk.turns_to_check(stored)
    assert turns == [caller("Mum?"), person("Yes?")]
    assert previous == {"level": "red", "turn_index": 1}


async def test_a_check_stores_and_publishes_a_risk_event(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(llm, "run_job", FakeRunJob({"signals": ["new_number"], "reason": "A new number"}))
    call_id = make_call()
    events.publish(call_id, "turn", caller("Mum? It's me, this is a new number."))
    events.publish(call_id, "tactic", {"key": "new_number", "label": "New number"})

    received: list[dict[str, Any]] = []

    async def listen() -> None:
        async with aclosing(events.subscribe(call_id, after_seq=2)) as stream:
            async for event in stream:
                if event["type"] == "risk":
                    received.append(event)
                    return

    listener = asyncio.create_task(listen())
    await asyncio.sleep(0)
    data = await live_risk.check_once(call_id)
    await asyncio.wait_for(listener, 1)
    expected = {"level": "yellow", "signals": ["new_number"], "labels": ["New number"],
                "reason": "A new number", "turn_index": 0, "source": "risk.v1"}
    assert data == expected
    assert [event["data"] for event in risk_events(call_id)] == [expected]
    assert received[0]["data"] == expected and received[0]["seq"] == 3
    # Nothing new from the caller: no second check, no second event.
    events.publish(call_id, "turn", person("Who is this?"))
    assert await live_risk.check_once(call_id) is None
    assert len(risk_events(call_id)) == 1


async def test_one_check_at_a_time_then_once_more_on_the_latest_turns(monkeypatch: pytest.MonkeyPatch) -> None:
    gate = asyncio.Event()
    fake = FakeRunJob((gate, {"signals": ["money_request"], "reason": "Asks for money"}),
                      {"signals": [], "reason": "Nothing worrying yet"})
    monkeypatch.setattr(llm, "run_job", fake)
    call_id = make_call()
    events.publish(call_id, "turn", caller("Can you send me some money?"))
    assert live_risk.start_check(call_id) is True
    await asyncio.sleep(0.01)  # the first check is now waiting on the model
    assert len(fake.calls) == 1
    for text in ("It's for the rent.", "My landlord is waiting."):
        events.publish(call_id, "turn", caller(text))
        assert live_risk.start_check(call_id) is False  # one in flight: asks for one more run
    gate.set()
    await wait_until_idle(call_id)

    assert len(fake.calls) == 2  # two batches meanwhile made one more run, not two
    assert "landlord is waiting" in fake.calls[1]["user"]
    stored = [event["data"] for event in risk_events(call_id)]
    assert [(d["turn_index"], d["level"]) for d in stored] == [(0, "red"), (2, "red")]
    assert stored[1]["signals"] == ["money_request"] and stored[1]["reason"] == "Asks for money"
    assert live_risk.start_check(call_id) is True  # free again once it has finished
    await wait_until_idle(call_id)
    assert len(fake.calls) == 2  # and with nothing new from the caller it stores nothing


async def test_switched_off_it_starts_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RISK_CHECK_ENABLED", "false")
    get_settings.cache_clear()
    call_id = make_call()
    events.publish(call_id, "turn", caller("Send me money."))
    assert live_risk.start_check(call_id) is False
    assert not live_risk.is_running(call_id)


@pytest.mark.parametrize("kind", ["welcome", "family_line"])
async def test_welcome_and_family_line_calls_are_never_checked(kind: str) -> None:
    call_id = make_call(kind)
    events.publish(call_id, "turn", caller("Send me money today and don't tell anyone."))
    assert await live_risk.check_once(call_id) is None
    assert risk_events(call_id) == []


# ---------------------------------------------------------------- through the events endpoint


def test_a_caller_turn_on_a_practice_call_publishes_risk_and_the_call_view_replays_it(client) -> None:
    call_id = make_call()
    response = client.post(f"/api/calls/{call_id}/events", json={"events": [
        {"type": "turn", "speaker": "agent", "text": "Mum? I dropped my phone, this is a new number."},
        {"type": "tactic", "key": "new_number"},
    ]})
    assert response.json() == {"ok": True}
    first = wait_for_risk(call_id)
    assert [event["data"]["level"] for event in first] == ["yellow"]

    client.post(f"/api/calls/{call_id}/events", json={"events": [
        {"type": "turn", "speaker": "user", "text": "Oh no. What do you need?"},
        {"type": "turn", "speaker": "agent", "text": "Could you send me 400 euros today? Please don't tell Dad."},
    ]})
    stored = wait_for_risk(call_id, 2)
    assert stored[1]["data"] == {
        "level": "red",
        "signals": ["new_number", "urgency", "secrecy", "money_request"],
        "labels": ["New number", "Urgency", "Secrecy", "Asks for money"],
        "reason": "Caller asks for money and wants it kept secret",
        "turn_index": 2,
        "source": "fallback",  # no keys in the tests
    }
    assert stored[1]["t"] is not None

    view = client.get(f"/api/calls/{call_id}").json()
    assert [(point["level"], point["turn_index"]) for point in view["risk"]] == [("yellow", 0), ("red", 2)]
    assert view["turns"][2]["text"].startswith("Could you send me")
    assert view["risk"][1]["t"] == stored[1]["t"]


def test_the_live_stream_carries_the_risk_event(client, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(streams, "KEEPALIVE_SECONDS", 0.2)
    call_id = make_call()
    with client.stream("GET", f"/api/calls/{call_id}/events") as response:
        lines = response.iter_lines()
        client.post(f"/api/calls/{call_id}/events", json={"events": [
            {"type": "turn", "speaker": "agent", "text": "Read me the code we texted you, quickly."},
        ]})
        blocks = [block for block in read_blocks(lines, 6) if block.get("event") == "risk"]
    assert blocks, "no risk event on the stream"
    data = json.loads(blocks[0]["data"])
    assert data["level"] == "red" and "asks_for_code" in data["signals"]
    assert set(data) == {"level", "signals", "labels", "reason", "turn_index", "source", "t"}


def test_only_caller_turns_on_practice_calls_start_a_check(client, monkeypatch: pytest.MonkeyPatch) -> None:
    started: list[str] = []
    monkeypatch.setattr(live_risk, "start_check", started.append)
    practice, welcome = make_call(), make_call("welcome")
    for call_id in (practice, welcome):
        client.post(f"/api/calls/{call_id}/events", json={"events": [
            {"type": "turn", "speaker": "user", "text": "Hello?"},
            {"type": "tactic", "key": "urgency"},
        ]})
    assert started == []  # no caller turn, and tactic events never start one
    client.post(f"/api/calls/{welcome}/events", json={"events": [
        {"type": "turn", "speaker": "agent", "text": "Hi Sara, this is Callback."}]})
    assert started == []  # not a practice
    client.post(f"/api/calls/{practice}/events", json={"events": [
        {"type": "turn", "speaker": "agent", "text": "Mum?"}, {"type": "turn", "speaker": "agent", "text": "Hi."}]})
    assert started == [practice]  # once per batch


def test_a_call_view_without_checks_has_an_empty_risk_list(client) -> None:
    call_id = make_call("welcome")
    assert client.get(f"/api/calls/{call_id}").json()["risk"] == []

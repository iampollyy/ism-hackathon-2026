"""Track A tests: scenarios, services/briefs.py and GET /api/scenarios. OWNER: track A."""

import asyncio
import json
import re
import time
from typing import Any

import pytest

from app import schemas
from app.agents import director
from app.db import new_session, now_iso
from app.ids import new_call_id
from app.models import Call, Member, Result
from app.services import briefs, scenarios

KEYS = ["bank_security", "hospital", "police", "relative_new_number"]


def use_director(monkeypatch, result: Any) -> list[dict[str, Any]]:
    """Replace the director: `result` is a value, an exception, or a callable(template)."""
    contexts: list[dict[str, Any]] = []

    async def fake(template: dict[str, Any], context: dict[str, Any]) -> dict[str, Any] | None:
        contexts.append(context)
        if isinstance(result, BaseException):
            raise result
        return result(template) if callable(result) else result

    monkeypatch.setattr(director, "improve_brief", fake)
    return contexts


@pytest.fixture(autouse=True)
def no_director(monkeypatch) -> None:
    use_director(monkeypatch, None)


async def build(member_ids: list[str], scenario: str, *, target: int = 0, voice: int | None = 1,
                difficulty: int = 1) -> briefs.BuiltBrief:
    with new_session() as s:
        target_row = s.get(Member, member_ids[target])
        voice_row = s.get(Member, member_ids[voice]) if voice is not None else None
        return await briefs.build_brief(s, target_row, voice_row, scenario, difficulty)


def ids(family: dict[str, Any]) -> list[str]:
    return [m["id"] for m in family["members"]]


GOOD = {
    "caller_claim": "Sara's son, Jon",
    "address_as": "Mum",
    "opening_line": "Mum, it's me, Jon. My phone broke, I'm on a friend's.",
    "scenario_brief": "You are at the station, your phone fell and cracked, and your card is at home. "
                      "You need to pay for a train ticket and a charger today.",
    "ask": "a transfer of 150 euros to your friend's account today",
    "tactic_order": ["urgency", "new_number"],
}


# ---------------------------------------------------------------- scenario files


def test_four_scenario_files_with_complete_templates() -> None:
    assert [s["key"] for s in scenarios.list_scenarios()] == KEYS
    for scenario in scenarios.list_scenarios():
        template = scenario["template"]
        for field in ("caller_claim", "opening_line", "scenario_brief", "ask", "tactic_order"):
            assert template[field], (scenario["key"], field)
        assert set(template["tactic_order"]) <= set(scenario["allowed_tactics"]) <= set(schemas.TACTICS)
        assert scenario["voice"] == "clone" or scenario["voice"].startswith("ELEVENLABS_")


def test_hospital_is_an_unpaid_fee_without_an_emergency() -> None:
    text = json.dumps(scenarios.get_scenario("hospital")).lower()
    assert "fee" in text and "appointment" in text
    for word in ("accident", "injur", "arrest", "emergency", "kidnap", "death"):
        assert word not in text


def test_get_scenario_rejects_odd_keys() -> None:
    assert scenarios.get_scenario("police")["key"] == "police"
    assert scenarios.get_scenario("../config") is None
    assert scenarios.get_scenario("nope") is None


def test_get_scenarios_endpoint(client) -> None:
    response = client.get("/api/scenarios")
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list) and [item["key"] for item in body] == KEYS
    voices = {item["key"]: item["voice"] for item in body}
    assert voices == {"bank_security": "library", "hospital": "library", "police": "library",
                      "relative_new_number": "clone"}
    for item in body:
        assert set(item) == {"key", "title", "voice", "caller_label", "allowed_tactics"}


# ---------------------------------------------------------------- fixed wording and names


def test_reveal_line_is_exactly_ai_md() -> None:
    assert briefs.reveal_line("Sara", "Jon") == (
        "Sara, this was a Callback practice call. The voice you heard was artificial, made with Jon's permission.")
    assert briefs.reveal_line("Sara", None) == (
        "Sara, this was a Callback practice call. The voice you heard was artificial.")


def test_caller_number_is_made_up() -> None:
    for _ in range(20):
        number = briefs.make_caller_number()
        assert re.fullmatch(r"\+00 6\d\d 555 01\d\d", number), number


@pytest.mark.parametrize("person,other,expected", [
    ("son", "mother", "son"), ("mother", "son", "mother"), ("daughter", "son", "sister"),
    ("father", "mother", "partner"), ("grandson", "grandmother", "grandson"), ("grandson", "mother", "son"),
    ("Mum", "daughter", "mother"), ("friend", "mother", "friend"), ("son", "friend", "relative"),
])
def test_relation_of(person, other, expected) -> None:
    assert briefs.relation_of(person, other) == expected


# ---------------------------------------------------------------- the template brief


async def test_relative_template_with_jon_as_voice(make_family) -> None:
    built = await build(ids(make_family()), "relative_new_number", difficulty=2)
    v = built.variables
    assert v["target_name"] == "Sara"
    assert v["caller_claim"] == "Sara's son, Jon"
    assert v["address_as"] == "Mum"
    assert v["opening_line"] == "Mum? It's me. I dropped my phone, so this is a new number."
    assert v["tactic_order"] == "new_number, urgency, secrecy"
    assert v["difficulty"] == 2
    assert v["reveal_line"].endswith("made with Jon's permission.")
    assert built.caller_label == "Unknown number"
    assert set(v) == {"target_name", "caller_claim", "address_as", "opening_line", "scenario_brief", "ask",
                      "tactic_order", "difficulty", "reveal_line"}


async def test_relative_template_without_a_clone_names_the_organiser(make_family) -> None:
    built = await build(ids(make_family()), "relative_new_number", voice=None)
    assert built.variables["caller_claim"] == "Sara's son, Jon"
    assert built.variables["reveal_line"].endswith("The voice you heard was artificial.")


async def test_relative_template_for_the_organiser(make_family) -> None:
    built = await build(ids(make_family()), "relative_new_number", target=1, voice=0)
    assert built.variables["caller_claim"] == "Jon's mother, Sara"
    assert built.variables["address_as"] == "Jon"


@pytest.mark.parametrize("key", ["police", "bank_security", "hospital"])
async def test_library_templates_pass_the_checks(make_family, key) -> None:
    built = await build(ids(make_family()), key, voice=None)
    v = built.variables
    assert not any("{" in str(value) or "}" in str(value) for value in v.values())
    brief = {**v, "tactic_order": v["tactic_order"].split(", ")}
    assert briefs.brief_problems(brief, scenarios.get_scenario(key)["allowed_tactics"]) == []
    assert v["address_as"] == "Sara"


async def test_unknown_scenario_falls_back_to_the_relative_story(make_family) -> None:
    built = await build(ids(make_family()), "no_such_scenario")
    assert built.variables["caller_claim"] == "Sara's son, Jon"


async def test_difficulty_is_clamped(make_family) -> None:
    assert (await build(ids(make_family()), "police", voice=None, difficulty=9)).variables["difficulty"] == 3


# ---------------------------------------------------------------- the checks


ALLOWED = ["new_number", "urgency", "secrecy", "emotional_appeal", "small_ask_first"]


def test_good_brief_has_no_problems() -> None:
    assert briefs.brief_problems(GOOD, ALLOWED) == []


@pytest.mark.parametrize("change", [
    {"ask": "a transfer to card 4111 1111 1111 1111"},
    {"scenario_brief": "Your account 12345678 is blocked."},
    {"ask": "send it through Barclays today"},
    {"caller_claim": "a manager at Deutsche Bank"},
    {"opening_line": "Hi, go to www.example.com now"},
    {"scenario_brief": "You had an accident on the way to work."},
    {"opening_line": "Mum? It's {{target_name}}"},
    {"tactic_order": ["urgency", "flattery"]},
    {"tactic_order": ["authority"]},  # a real tactic, but not allowed in this scenario
    {"tactic_order": ["urgency", "secrecy", "new_number", "emotional_appeal"]},
    {"tactic_order": ["urgency", "urgency"]},
    {"tactic_order": []},
    {"ask": "word " * 60},
    {"address_as": ""},
])
def test_bad_briefs_are_caught(change) -> None:
    assert briefs.brief_problems({**GOOD, **change}, ALLOWED)


def test_non_dict_brief_is_caught() -> None:
    assert briefs.brief_problems(["not", "a", "brief"], ALLOWED)


@pytest.mark.parametrize("text", [
    "He died this morning.", "She was hit by a car.", "He is in hospital after a fall.",
    "Your sister is in jail tonight.", "It is a medical emergency.", "There was a crash.",
    "The ambulance has just left.", "She is in A&E.", "He was hospitalised.",
    "The police have him in custody.",
])
def test_emergency_briefs_are_caught(text) -> None:
    assert briefs.brief_problems({**GOOD, "scenario_brief": text}, ALLOWED)


def test_ordinary_words_are_not_caught() -> None:
    brief = {**GOOD, "scenario_brief": "The deadline for the payment is today."}
    assert briefs.brief_problems(brief, ALLOWED) == []


@pytest.mark.parametrize("name, expected", [
    ("The Kovacs", "Kovacs"), ("Kovacs family", "Kovacs"), ("the Smiths", "Smiths"),
    ("Kovacs", "Kovacs"), ("The", "The"),
])
def test_family_display_name(name, expected) -> None:
    assert briefs.family_display_name(name) == expected


def test_library_voice_id_reads_only_voice_settings() -> None:
    from app.config import get_settings
    settings = get_settings()
    for name in ("ELEVENLABS_API_KEY", "OPENAI_API_KEY", "elevenlabs_practice_agent_id", "database_url"):
        assert scenarios.library_voice_id({"key": "x", "voice": name}, settings) == ""
    assert scenarios.library_voice_id({"key": "x", "voice": "clone"}, settings) == ""


# ---------------------------------------------------------------- the director


async def test_good_director_brief_is_used(make_family, monkeypatch) -> None:
    use_director(monkeypatch, {**GOOD, "tactic_order": "urgency, new_number", "extra": "dropped"})
    v = (await build(ids(make_family()), "relative_new_number")).variables
    assert v["opening_line"] == GOOD["opening_line"]
    assert v["tactic_order"] == "urgency, new_number"
    assert "extra" not in v
    assert v["reveal_line"].endswith("made with Jon's permission.")


async def test_bad_director_brief_falls_back_to_the_template(make_family, monkeypatch) -> None:
    use_director(monkeypatch, {**GOOD, "ask": "pay at HSBC now"})
    v = (await build(ids(make_family()), "relative_new_number")).variables
    assert v["opening_line"] == "Mum? It's me. I dropped my phone, so this is a new number."


async def test_director_cannot_write_the_reveal(make_family, monkeypatch) -> None:
    use_director(monkeypatch, {**GOOD, "reveal_line": "This was real."})
    v = (await build(ids(make_family()), "relative_new_number")).variables
    assert v["reveal_line"] == briefs.reveal_line("Sara", "Jon")


async def test_director_error_falls_back(make_family, monkeypatch) -> None:
    use_director(monkeypatch, RuntimeError("model down"))
    v = (await build(ids(make_family()), "relative_new_number")).variables
    assert v["caller_claim"] == "Sara's son, Jon"


async def test_slow_director_is_cut_off(make_family, monkeypatch) -> None:
    family = make_family()

    async def slow(template: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        await asyncio.sleep(5)
        return GOOD

    monkeypatch.setattr(director, "improve_brief", slow)
    monkeypatch.setattr(briefs, "DIRECTOR_TIMEOUT_SECONDS", 0.1)
    started = time.monotonic()
    v = (await build(ids(family), "relative_new_number")).variables
    assert time.monotonic() - started < 2
    assert v["caller_claim"] == "Sara's son, Jon"


async def test_director_gets_the_template_and_the_person(make_family, monkeypatch) -> None:
    family = make_family()
    sara, jon = ids(family)
    with new_session() as s:
        row = s.get(Member, sara)
        row.profile_json = json.dumps({"said": "If the bank rings, I do what they say.", "weak_spot": "old"})
        row.plan_json = json.dumps({"weak_spot": "Acts fast when a caller sounds official."})
        call_id = new_call_id()
        s.add(Call(id=call_id, family_id=family["family_id"], kind="practice", target_member_id=sara,
                   status="scored", created_at=now_iso()))
        s.flush()
        s.add(Result(call_id=call_id, outcome="agreed", tactics_used_json='["urgency"]',
                     tactics_worked_json='["urgency"]', lesson="x", created_at=now_iso()))
        s.commit()
    seen_templates: list[dict[str, Any]] = []
    contexts = use_director(monkeypatch, lambda template: seen_templates.append(template) or None)
    await build([sara, jon], "relative_new_number", difficulty=2)
    context = contexts[0]
    assert context["target_name"] == "Sara" and context["relationship"] == "mother"
    assert context["weak_spot"] == "Acts fast when a caller sounds official."
    assert context["said"] == "If the bank rings, I do what they say."
    assert context["tactics_worked"] == ["urgency"]
    assert context["caller_name"] == "Jon" and context["difficulty"] == 2
    assert context["allowed_tactics"] == ALLOWED
    assert seen_templates[0]["tactic_order"] == ["new_number", "urgency", "secrecy"]
    assert seen_templates[0]["caller_claim"] == "Sara's son, Jon"

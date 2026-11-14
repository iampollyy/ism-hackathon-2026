"""Track A tests: services/sessions.py. OWNER: track A.

Call rows are inserted by hand, the way track B commits them before calling
build_session; nothing here depends on track B's endpoints.
"""

import json
from typing import Any

import pytest
import respx

from app import schemas
from app.agents import director
from app.config import get_settings
from app.db import new_session, now_iso
from app.ids import new_call_id
from app.models import Call, CallEvent, Member, Result
from app.services import briefs, elevenlabs, sessions


@pytest.fixture(autouse=True)
def no_director(monkeypatch) -> None:
    async def none(template: dict[str, Any], context: dict[str, Any]) -> None:
        return None

    monkeypatch.setattr(director, "improve_brief", none)


def ids(family: dict[str, Any]) -> list[str]:
    return [m["id"] for m in family["members"]]


def give_voice(member_id: str, voice_id: str = "voice_jon_1", status: str = "ready") -> None:
    with new_session() as s:
        row = s.get(Member, member_id)
        row.voice_id, row.voice_status, row.consent_clone_at = voice_id, status, now_iso()
        s.commit()


async def practice(family: dict[str, Any], scenario: str = "relative_new_number", voice: bool = True,
                   difficulty: int = 2, store_brief: bool = True) -> str:
    sara, jon = ids(family)[:2]
    with new_session() as s:
        target = s.get(Member, sara)
        voice_member = s.get(Member, jon) if voice else None
        built = await briefs.build_brief(s, target, voice_member, scenario, difficulty)
        call_id = new_call_id()
        s.add(Call(id=call_id, family_id=family["family_id"], kind="practice", target_member_id=sara,
                   voice_member_id=jon if voice else None, scenario=scenario, difficulty=difficulty,
                   brief_json=json.dumps(built.variables) if store_brief else None,
                   caller_label=built.caller_label, caller_number=built.caller_number,
                   status="in_progress", answered_at=now_iso(), created_at=now_iso()))
        s.commit()
    return call_id


def other_call(family: dict[str, Any], kind: str, *, target: int = 0, parent: str | None = None,
               status: str = "in_progress", ended_by: str | None = None, voice: bool = False) -> str:
    member_ids = ids(family)
    call_id = new_call_id()
    with new_session() as s:
        s.add(Call(id=call_id, family_id=family["family_id"], kind=kind, target_member_id=member_ids[target],
                   voice_member_id=member_ids[1] if voice else None, parent_call_id=parent,
                   scenario="relative_new_number" if kind == "practice" else None, status=status,
                   ended_by=ended_by, answered_at=now_iso(), created_at=now_iso()))
        s.commit()
    return call_id


async def session(call_id: str) -> schemas.Session:
    with new_session() as s:
        return await sessions.build_session(s, s.get(Call, call_id))


def stored_conversation_id(call_id: str) -> str | None:
    with new_session() as s:
        return s.get(Call, call_id).conversation_id


# ---------------------------------------------------------------- practice


async def test_practice_with_clone(make_family) -> None:
    family = make_family()
    give_voice(ids(family)[1], "voice_jon_9")
    call_id = await practice(family)
    result = await session(call_id)
    assert result.kind == "practice"
    assert result.conversation_token.startswith("fake-token-")
    assert result.conversation_id.startswith("conv_fake_")
    assert stored_conversation_id(call_id) == result.conversation_id
    assert result.overrides == {"tts": {"voiceId": "voice_jon_9"}}
    assert result.max_seconds == 150
    assert result.reveal == schemas.Reveal(voice_of="Jon")
    v = result.dynamic_variables
    assert v["reveal_line"] == briefs.reveal_line("Sara", "Jon")
    assert v["tactic_order"] == "new_number, urgency, secrecy"
    assert v["difficulty"] == 2
    for name, value in v.items():
        assert isinstance(value, (str, int, float)) and not isinstance(value, bool), name


@pytest.mark.parametrize("scenario,voice_id", [
    ("police", "voice_police_test"), ("bank_security", "voice_bank_test"), ("hospital", "voice_nurse_test"),
])
async def test_practice_with_library_voice(make_family, scenario, voice_id) -> None:
    result = await session(await practice(make_family(), scenario, voice=False))
    assert result.overrides == {"tts": {"voiceId": voice_id}}
    assert result.reveal == schemas.Reveal(voice_of=None)
    assert result.dynamic_variables["reveal_line"] == briefs.reveal_line("Sara", None)


async def test_relative_story_without_a_clone_uses_the_agent_voice(make_family) -> None:
    result = await session(await practice(make_family(), voice=False))
    assert result.overrides == {}
    assert result.reveal == schemas.Reveal(voice_of=None)


async def test_a_deleted_clone_is_never_sent(make_family) -> None:
    family = make_family()
    jon = ids(family)[1]
    give_voice(jon, "voice_jon_9")
    call_id = await practice(family)
    give_voice(jon, "voice_jon_9", status="deleted")
    result = await session(call_id)
    assert "voice_jon_9" not in json.dumps(result.overrides)


async def test_missing_brief_falls_back_to_the_template(make_family) -> None:
    family = make_family()
    give_voice(ids(family)[1])
    result = await session(await practice(family, store_brief=False))
    assert result.dynamic_variables["caller_claim"] == "Sara's son, Jon"
    assert result.dynamic_variables["reveal_line"] == briefs.reveal_line("Sara", "Jon")


def test_plain_variables_are_strings_or_numbers() -> None:
    plain = sessions.plain_variables({"a": ["x", "y"], "b": None, "c": True, "d": 2, "e": {"k": 1}})
    assert plain == {"a": "x, y", "b": "", "c": "yes", "d": 2, "e": '{"k": 1}'}


# ---------------------------------------------------------------- welcome and family line


async def test_welcome_session(make_family) -> None:
    family = make_family()
    call_id = other_call(family, "welcome")
    result = await session(call_id)
    assert result.kind == "welcome" and result.overrides == {} and result.reveal is None
    assert result.max_seconds == 330
    assert result.dynamic_variables == {"member_name": "Sara", "organiser_name": "Jon",
                                        "family_name": "Kovacs"}
    assert stored_conversation_id(call_id) == result.conversation_id


async def test_family_line_with_a_result(make_family) -> None:
    family = make_family()
    practice_id = other_call(family, "practice", status="scored", voice=True)
    with new_session() as s:
        s.add(Result(call_id=practice_id, outcome="asked_safe_word", tactics_used_json="[]",
                     tactics_worked_json="[]", lesson="x", created_at=now_iso()))
        s.commit()
    result = await session(other_call(family, "family_line", parent=practice_id))
    assert result.kind == "family_line" and result.overrides == {} and result.max_seconds == 60
    v = result.dynamic_variables
    assert v["caller_name"] == "Sara" and v["relative_name"] == "Jon"
    assert "Jon's voice" in v["what_happened"] and "family word" in v["what_happened"]
    assert v["family_name"] == "Kovacs"


async def test_family_line_reads_the_outcome_event_before_scoring(make_family) -> None:
    family = make_family()
    practice_id = other_call(family, "practice", status="ended", voice=True)
    with new_session() as s:
        s.add(CallEvent(call_id=practice_id, seq=1, type="outcome", t=12.0,
                        data_json=json.dumps({"outcome": "hung_up"}), created_at=now_iso()))
        s.commit()
    v = (await session(other_call(family, "family_line", parent=practice_id))).dynamic_variables
    assert "hung up" in v["what_happened"]


async def test_family_line_without_a_voice_names_the_organiser(make_family) -> None:
    family = make_family()
    practice_id = other_call(family, "practice", status="ended", ended_by="user")
    v = (await session(other_call(family, "family_line", parent=practice_id))).dynamic_variables
    assert v["relative_name"] == "Jon"
    assert v["what_happened"].strip()


# ---------------------------------------------------------------- agents and errors


async def test_missing_agent_id_is_503_in_real_mode(make_family, monkeypatch) -> None:
    family = make_family()
    call_id = other_call(family, "welcome")
    monkeypatch.setenv("FAKE_ELEVENLABS", "false")
    monkeypatch.setenv("ELEVENLABS_API_KEY", "k")
    monkeypatch.setenv("ELEVENLABS_WELCOME_AGENT_ID", "")
    get_settings.cache_clear()
    with pytest.raises(elevenlabs.ElevenLabsError) as caught:
        await session(call_id)
    assert (caught.value.status_code, caught.value.code) == (503, "agent_not_configured")
    assert stored_conversation_id(call_id) is None


async def test_real_token_uses_the_right_agent_and_is_stored(make_family, monkeypatch) -> None:
    family = make_family()
    call_id = other_call(family, "welcome")
    monkeypatch.setenv("FAKE_ELEVENLABS", "false")
    monkeypatch.setenv("ELEVENLABS_API_KEY", "k")
    get_settings.cache_clear()
    with respx.mock(base_url=elevenlabs.BASE_URL) as router:
        route = router.get("/v1/convai/conversation/token").respond(
            200, json={"token": "tok_real", "conversation_id": "conv_real"})
        result = await session(call_id)
    assert route.calls.last.request.url.params["agent_id"] == "agent_welcome_test"
    assert result.conversation_token == "tok_real"
    assert stored_conversation_id(call_id) == "conv_real"


async def test_token_failure_stores_nothing(make_family, monkeypatch) -> None:
    family = make_family()
    call_id = other_call(family, "welcome")
    monkeypatch.setenv("FAKE_ELEVENLABS", "false")
    monkeypatch.setenv("ELEVENLABS_API_KEY", "k")
    get_settings.cache_clear()
    with respx.mock(base_url=elevenlabs.BASE_URL) as router:
        router.get("/v1/convai/conversation/token").respond(500, json={"detail": "down"})
        with pytest.raises(elevenlabs.ElevenLabsError):
            await session(call_id)
    assert stored_conversation_id(call_id) is None

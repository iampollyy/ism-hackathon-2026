"""Track B tests: the phone page's requests and the family number.
OWNER: track B. Tracks A and C are faked with monkeypatch."""

import json
from datetime import timedelta

import pytest
from sqlalchemy import select

from app import events, schemas
from app.db import new_session, now_iso, parse_time, to_iso, utcnow
from app.models import Call, Member, Message, ReadinessSnapshot, Result
from app.services import briefs, pipeline, sessions


@pytest.fixture
def fakes(monkeypatch) -> list[str]:
    """Fakes for build_brief, build_session and after_call; returns the ids
    of the calls a session was built for."""
    built: list[str] = []

    async def fake_build_brief(db, target, voice_member, scenario_key, difficulty):
        return briefs.BuiltBrief(variables={"target_name": target.name}, caller_label="Unknown number",
                                 caller_number="+00 600 555 0142")

    async def fake_build_session(db, call):
        built.append(call.id)
        return schemas.Session(kind=call.kind, conversation_token="tok", conversation_id="conv_test",
                               overrides={}, dynamic_variables={}, max_seconds=schemas.MAX_SECONDS[call.kind])

    async def fake_after_call(call_id):
        return None

    monkeypatch.setattr(briefs, "build_brief", fake_build_brief)
    monkeypatch.setattr(sessions, "build_session", fake_build_session)
    monkeypatch.setattr(pipeline, "after_call", fake_after_call)
    return built


def members(family) -> tuple[str, str]:
    return family["members"][0]["id"], family["members"][1]["id"]


def ago(seconds: float) -> str:
    return to_iso(utcnow() - timedelta(seconds=seconds))


def ended_practice(client, family, voice: bool = True, ended_ago: float = 20) -> str:
    """A practice for Sara, answered and ended, with ended_at moved into the past."""
    sara, jon = members(family)
    body = {"target_member_id": sara, "scenario": "relative_new_number" if voice else "police"}
    if voice:
        with new_session() as db:
            member = db.get(Member, jon)
            member.consent_clone_at, member.voice_id, member.voice_status = now_iso(), "voice_test", "ready"
            db.commit()
        body["voice_member_id"] = jon
    client.get(f"/api/members/{sara}/phone-state")
    call_id = client.post("/api/practice-calls", json=body).json()["call_id"]
    client.post(f"/api/calls/{call_id}/answer")
    client.post(f"/api/calls/{call_id}/end", json={"ended_by": "agent"})
    with new_session() as db:
        db.get(Call, call_id).ended_at = ago(ended_ago)
        db.commit()
    return call_id


def tap(client, member_id: str):
    return client.post(f"/api/members/{member_id}/family-line")


# ---------------------------------------------------------------- phone state


def test_phone_state_records_last_seen_and_shows_the_member(client, make_family):
    sara, _ = members(make_family())
    body = client.get(f"/api/members/{sara}/phone-state").json()
    assert body == {"member": {"id": sara, "name": "Sara", "family": "The Kovacs"},
                    "incoming_call": None, "messages": [], "family_number": {"enabled": True}}
    with new_session() as db:
        seen = parse_time(db.get(Member, sara).last_seen_at)
    assert (utcnow() - seen).total_seconds() < 5
    assert client.get("/api/members/mem_nope/phone-state").status_code == 404


def test_incoming_call_only_while_ringing(client, make_family, fakes):
    sara, _ = members(make_family())
    client.get(f"/api/members/{sara}/phone-state")
    call_id = client.post("/api/practice-calls", json={"target_member_id": sara}).json()["call_id"]
    incoming = client.get(f"/api/members/{sara}/phone-state").json()["incoming_call"]
    assert incoming == {"call_id": call_id, "kind": "practice",
                        "caller": {"label": "Unknown number", "number": "+00 600 555 0142"}}
    client.post(f"/api/calls/{call_id}/answer")
    assert client.get(f"/api/members/{sara}/phone-state").json()["incoming_call"] is None


def test_no_incoming_call_once_the_member_has_opted_out(client, make_family, fakes):
    sara, _ = members(make_family())
    client.get(f"/api/members/{sara}/phone-state")
    client.post("/api/practice-calls", json={"target_member_id": sara})
    with new_session() as db:
        db.get(Member, sara).opted_out_at = now_iso()
        db.commit()
    assert client.get(f"/api/members/{sara}/phone-state").json()["incoming_call"] is None


def test_messages_unread_and_marked_read(client, make_family):
    sara, jon = members(make_family())
    with new_session() as db:
        rows = [Message(member_id=sara, kind="weekly", text=f"m{i}", created_at=now_iso()) for i in range(3)]
        db.add_all(rows + [Message(member_id=jon, kind="weekly", text="his", created_at=now_iso())])
        db.commit()
        first_id = rows[0].id
    assert [m["text"] for m in client.get(f"/api/members/{sara}/phone-state").json()["messages"]] == ["m0", "m1", "m2"]
    assert client.post(f"/api/members/{sara}/messages/read", json={"ids": [first_id]}).json() == {"ok": True}
    assert [m["text"] for m in client.get(f"/api/members/{sara}/phone-state").json()["messages"]] == ["m1", "m2"]
    assert client.post(f"/api/members/{sara}/messages/read").status_code == 200  # no body: all
    assert client.get(f"/api/members/{sara}/phone-state").json()["messages"] == []
    assert len(client.get(f"/api/members/{jon}/phone-state").json()["messages"]) == 1
    assert client.post("/api/members/mem_nope/messages/read", json={}).status_code == 404


# ---------------------------------------------------------------- family number


def test_family_line_needs_a_recent_practice(client, make_family, fakes):
    family = make_family()
    sara, _ = members(family)
    response = tap(client, sara)
    assert (response.status_code, response.json()["error"]["code"]) == (404, "no_recent_practice")
    ended_practice(client, family, ended_ago=11 * 60)
    assert tap(client, sara).json()["error"]["code"] == "no_recent_practice"
    assert tap(client, "mem_nope").status_code == 404


def test_family_line_connects_and_tells_the_voice_owner(client, make_family, fakes):
    family = make_family()
    sara, jon = members(family)
    practice_id = ended_practice(client, family, ended_ago=20)
    response = tap(client, sara)
    assert response.status_code == 200
    body = response.json()
    assert body["session"]["kind"] == "family_line"
    with new_session() as db:
        line = db.get(Call, body["call_id"])
        assert (line.kind, line.status, line.parent_call_id) == ("family_line", "in_progress", practice_id)
        assert line.answered_at is not None
        seconds = db.get(Call, practice_id).callback_seconds
    assert 19.5 <= seconds <= 30
    connected = [e for e in events.list_events(practice_id) if e["type"] == "callback.connected"]
    assert [e["data"]["seconds"] for e in connected] == [seconds]
    notices = client.get(f"/api/members/{jon}/phone-state").json()["messages"]
    assert [(m["kind"], m["text"]) for m in notices] == [
        ("callback_notice", "Sara called the family number after a practice.")]
    assert fakes == [practice_id, body["call_id"]]

    # a second tap opens another line, ends the first, and records nothing twice
    second = tap(client, sara)
    assert second.status_code == 200
    assert len(client.get(f"/api/members/{jon}/phone-state").json()["messages"]) == 1
    connected = [e for e in events.list_events(practice_id) if e["type"] == "callback.connected"]
    assert len(connected) == 1, "a second tap does not announce the callback again"
    with new_session() as db:
        first_line = db.get(Call, body["call_id"])
        assert (first_line.status, first_line.ended_by) == ("ended", "user")
        open_lines = db.scalars(select(Call).where(Call.kind == "family_line", Call.status == "in_progress")).all()
        assert [line.id for line in open_lines] == [second.json()["call_id"]]


def test_family_line_ended_while_its_session_was_built_is_409(client, make_family, fakes, monkeypatch):
    family = make_family()
    sara, _ = members(family)
    ended_practice(client, family)

    async def ended_meanwhile(db, call):
        with new_session() as other:  # a second tap ends this line during the await
            other.get(Call, call.id).status = "ended"
            other.commit()
        return schemas.Session(kind=call.kind, conversation_token="tok", conversation_id="conv_test",
                               overrides={}, dynamic_variables={}, max_seconds=schemas.MAX_SECONDS[call.kind])

    monkeypatch.setattr(sessions, "build_session", ended_meanwhile)
    response = tap(client, sara)
    assert (response.status_code, response.json()["error"]["code"]) == (409, "call_over")


def test_family_line_tells_the_organiser_for_a_library_voice(client, make_family, fakes):
    family = make_family()
    sara, jon = members(family)
    ended_practice(client, family, voice=False)
    tap(client, sara)
    assert [m["kind"] for m in client.get(f"/api/members/{jon}/phone-state").json()["messages"]] == ["callback_notice"]


def test_family_line_after_scoring_updates_result_and_readiness(client, make_family, fakes):
    family = make_family()
    sara, _ = members(family)
    practice_id = ended_practice(client, family, ended_ago=20)
    items = [{"key": key, "score": 1, "evidence": "said so"} for key in schemas.READINESS_KEYS]
    with new_session() as db:
        db.add(Result(call_id=practice_id, outcome="hung_up", seconds_to_challenge=3.0, tactics_used_json="[]",
                      tactics_worked_json="[]", lesson="x", created_at=now_iso()))
        db.add(ReadinessSnapshot(member_id=sara, source_call_id=practice_id, items_json=json.dumps(items),
                                 total=5, max=10, created_at=now_iso()))
        db.commit()
    tap(client, sara)
    with new_session() as db:
        assert db.get(Result, practice_id).callback_seconds is not None
        latest = db.scalars(select(ReadinessSnapshot).order_by(ReadinessSnapshot.id.desc())).first()
    new_items = {item["key"]: item for item in json.loads(latest.items_json)}
    assert new_items["trusted_contact"]["score"] == 2
    assert new_items["safe_word"] == {"key": "safe_word", "score": 1, "evidence": "said so"}
    assert (latest.total, latest.max, latest.source_call_id) == (6, 10, practice_id)


def test_family_line_session_failure_marks_the_line_failed(client, make_family, fakes, monkeypatch):
    family = make_family()
    sara, _ = members(family)
    ended_practice(client, family)

    async def broken(db, call):
        raise RuntimeError("no token")

    monkeypatch.setattr(sessions, "build_session", broken)
    response = tap(client, sara)
    assert (response.status_code, response.json()["error"]["code"]) == (502, "session_failed")
    with new_session() as db:
        line = db.scalars(select(Call).where(Call.kind == "family_line")).one()
        assert line.status == "failed"

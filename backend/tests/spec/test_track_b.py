"""Track B spec tests: calls, phone page, event stream, scheduler.

Written from docs/backend.md alone (sections "The API", "The phone page's
requests", "Starting a practice", "Reading a call", "Live updates inside the
back end", "Call states", "The flows") and the track interface list.

Other tracks are faked with monkeypatch:
- sessions.build_session, briefs.build_brief (track A)
- pipeline.after_call (track C)
The fakes also probe the "no uncommitted writes across an await" rule: they
write through a second connection, which fails if the caller still holds a
write lock.
"""

import asyncio
import json
import threading
import time
from datetime import timedelta
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from sqlalchemy import select, text

from app import events as events_mod
from app import schemas
from app.db import new_session, now_iso, parse_time, to_iso, utcnow
from app.models import Call, CallEvent, Consent, Member, Message, ReadinessSnapshot, Result
from app.schemas import MAX_SECONDS, TACTIC_LABELS, ApiError

# ------------------------------------------------------------------ fakes


def _patch_everywhere(monkeypatch, source: str, name: str, fake) -> None:
    """Patch the function in its home module and in every track B module that
    may have imported it by name."""
    import importlib

    monkeypatch.setattr(f"{source}.{name}", fake)
    for module_name in ("app.routers.calls", "app.routers.phone", "app.routers.weekly",
                        "app.services.scheduler"):
        module = importlib.import_module(module_name)
        if hasattr(module, name):
            monkeypatch.setattr(module, name, fake)


def _probe_no_write_lock() -> None:
    """Fails if the caller still holds uncommitted writes."""
    with new_session() as other:
        other.execute(text("UPDATE families SET name = name"))
        other.commit()


@pytest.fixture
def fakes(monkeypatch) -> SimpleNamespace:
    state = SimpleNamespace(
        sessions=[], briefs=[], after=[], seen=[],
        session_error=None, after_error=None, after_delay=0.0, brief_hook=None,
    )

    async def fake_build_session(db, call):
        state.sessions.append(call.id)
        _probe_no_write_lock()
        with new_session() as other:
            row = other.get(Call, call.id)
            parent = other.get(Call, row.parent_call_id) if row.parent_call_id else None
            state.seen.append({
                "status": row.status,
                "answered_at": row.answered_at,
                "parent_callback_seconds": parent.callback_seconds if parent else None,
            })
        if state.session_error is not None:
            raise state.session_error
        call.conversation_id = f"conv_{call.id}"
        db.commit()
        return schemas.Session(
            kind=call.kind,
            conversation_token="tok_fake",
            conversation_id=f"conv_{call.id}",
            overrides={},
            dynamic_variables={"target_name": "Sara"},
            max_seconds=MAX_SECONDS[call.kind],
            reveal=schemas.Reveal(voice_of=None) if call.kind == "practice" else None,
        )

    async def fake_build_brief(db, target, voice_member, scenario_key, difficulty):
        state.briefs.append({
            "target": target.id, "voice": voice_member.id if voice_member else None,
            "scenario": scenario_key, "difficulty": difficulty,
        })
        _probe_no_write_lock()
        if state.brief_hook is not None:
            state.brief_hook()
        return SimpleNamespace(
            variables={"target_name": target.name, "difficulty": difficulty, "scenario": scenario_key},
            caller_label="Unknown number",
            caller_number="+00 600 555 0142",
        )

    async def fake_after_call(call_id):
        state.after.append(call_id)
        if state.after_delay:
            await asyncio.sleep(state.after_delay)
        if state.after_error is not None:
            raise state.after_error

    _patch_everywhere(monkeypatch, "app.services.sessions", "build_session", fake_build_session)
    _patch_everywhere(monkeypatch, "app.services.briefs", "build_brief", fake_build_brief)
    _patch_everywhere(monkeypatch, "app.services.pipeline", "after_call", fake_after_call)
    return state


# ------------------------------------------------------------------ helpers


def ids(fam: dict[str, Any]) -> tuple[str, str]:
    """(Sara the mother, Jon the son and organiser)"""
    return fam["members"][0]["id"], fam["members"][1]["id"]


def online(client, member_id: str) -> None:
    assert client.get(f"/api/members/{member_id}/phone-state").status_code == 200


def give_voice(member_id: str) -> None:
    with new_session() as db:
        member = db.get(Member, member_id)
        member.consent_clone_at = now_iso()
        member.voice_id = f"voice_{member_id}"
        member.voice_status = "ready"
        db.commit()


def set_member(member_id: str, **fields: Any) -> None:
    with new_session() as db:
        member = db.get(Member, member_id)
        for key, value in fields.items():
            setattr(member, key, value)
        db.commit()


def set_call(call_id: str, **fields: Any) -> None:
    with new_session() as db:
        call = db.get(Call, call_id)
        for key, value in fields.items():
            setattr(call, key, value)
        db.commit()


def row(call_id: str) -> dict[str, Any]:
    with new_session() as db:
        call = db.get(Call, call_id)
        return {c.name: getattr(call, c.name) for c in Call.__table__.columns}


def ago(seconds: float) -> str:
    return to_iso(utcnow() - timedelta(seconds=seconds))


def stored_events(call_id: str) -> list[dict[str, Any]]:
    return events_mod.list_events(call_id)


def statuses(call_id: str) -> list[str]:
    return [e["data"].get("status") for e in stored_events(call_id) if e["type"] == "call.status"]


def start_practice(client, fam, voice: bool = True, **extra: Any) -> str:
    sara, jon = ids(fam)
    online(client, sara)
    body = {"target_member_id": sara, "voice_member_id": jon if voice else None,
            "scenario": "relative_new_number", "difficulty": 2}
    body.update(extra)
    if voice:
        give_voice(jon)
    response = client.post("/api/practice-calls", json=body)
    assert response.status_code == 201, response.text
    return response.json()["call_id"]


def answered_practice(client, fam, **extra: Any) -> str:
    call_id = start_practice(client, fam, **extra)
    assert client.post(f"/api/calls/{call_id}/answer").status_code == 200
    return call_id


def ended_practice(client, fam, ended_ago: float = 20.0, **extra: Any) -> str:
    call_id = answered_practice(client, fam, **extra)
    assert client.post(f"/api/calls/{call_id}/end", json={"ended_by": "agent"}).status_code == 200
    set_call(call_id, ended_at=ago(ended_ago), answered_at=ago(ended_ago + 100))
    return call_id


def error_code(response) -> str:
    return response.json()["error"]["code"]


# ================================================================ practice gate


def test_practice_unknown_target_is_404(client, make_family, fakes):
    fam = make_family()
    response = client.post("/api/practice-calls", json={"target_member_id": "mem_nope"})
    assert response.status_code == 404
    assert error_code(response) == "not_found"


def test_practice_unknown_voice_member_is_404(client, make_family, fakes):
    sara, _ = ids(make_family())
    online(client, sara)
    response = client.post("/api/practice-calls", json={"target_member_id": sara, "voice_member_id": "mem_nope"})
    assert response.status_code == 404
    assert error_code(response) == "not_found"


def test_practice_voice_member_from_another_family_is_404(client, make_family, fakes):
    sara, _ = ids(make_family())
    other_sara, other_jon = ids(make_family())
    give_voice(other_jon)
    online(client, sara)
    response = client.post("/api/practice-calls", json={"target_member_id": sara, "voice_member_id": other_jon})
    assert response.status_code == 404
    assert error_code(response) == "not_found"


def test_practice_target_without_consent_is_409_consent_missing(client, make_family, fakes):
    sara, _ = ids(make_family(consent=False))
    online(client, sara)
    response = client.post("/api/practice-calls", json={"target_member_id": sara})
    assert response.status_code == 409
    assert error_code(response) == "consent_missing"
    assert fakes.briefs == []


def test_practice_target_who_opted_out_is_consent_missing(client, make_family, fakes):
    sara, _ = ids(make_family())
    set_member(sara, opted_out_at=now_iso())
    online(client, sara)
    response = client.post("/api/practice-calls", json={"target_member_id": sara})
    assert response.status_code == 409
    assert error_code(response) == "consent_missing"


def test_practice_voice_member_without_voice_is_voice_not_ready(client, make_family, fakes):
    sara, jon = ids(make_family())
    online(client, sara)
    response = client.post("/api/practice-calls", json={"target_member_id": sara, "voice_member_id": jon})
    assert response.status_code == 409
    assert error_code(response) == "voice_not_ready"


def test_practice_voice_without_clone_consent_is_voice_not_ready(client, make_family, fakes):
    sara, jon = ids(make_family())
    give_voice(jon)
    set_member(jon, consent_clone_at=None)
    online(client, sara)
    response = client.post("/api/practice-calls", json={"target_member_id": sara, "voice_member_id": jon})
    assert response.status_code == 409
    assert error_code(response) == "voice_not_ready"


def test_practice_voice_failed_status_is_voice_not_ready(client, make_family, fakes):
    sara, jon = ids(make_family())
    give_voice(jon)
    set_member(jon, voice_status="failed")
    online(client, sara)
    response = client.post("/api/practice-calls", json={"target_member_id": sara, "voice_member_id": jon})
    assert response.status_code == 409
    assert error_code(response) == "voice_not_ready"


def test_practice_voice_deleted_is_voice_not_ready(client, make_family, fakes):
    sara, jon = ids(make_family())
    give_voice(jon)
    set_member(jon, voice_status="deleted", voice_id=None)
    online(client, sara)
    response = client.post("/api/practice-calls", json={"target_member_id": sara, "voice_member_id": jon})
    assert response.status_code == 409
    assert error_code(response) == "voice_not_ready"


def test_practice_voice_member_opted_out_is_voice_not_ready(client, make_family, fakes):
    sara, jon = ids(make_family())
    give_voice(jon)
    set_member(jon, opted_out_at=now_iso())
    online(client, sara)
    response = client.post("/api/practice-calls", json={"target_member_id": sara, "voice_member_id": jon})
    assert response.status_code == 409
    assert error_code(response) == "voice_not_ready"


def test_practice_busy_when_target_call_is_ringing(client, make_family, fakes):
    fam = make_family()
    sara, jon = ids(fam)
    start_practice(client, fam)
    response = client.post("/api/practice-calls", json={"target_member_id": sara, "voice_member_id": jon})
    assert response.status_code == 409
    assert error_code(response) == "busy"


def test_practice_busy_when_target_call_is_in_progress(client, make_family, fakes):
    fam = make_family()
    sara, _ = ids(fam)
    answered_practice(client, fam)
    response = client.post("/api/practice-calls", json={"target_member_id": sara})
    assert response.status_code == 409
    assert error_code(response) == "busy"


def test_practice_not_busy_after_call_ended(client, make_family, fakes):
    fam = make_family()
    sara, _ = ids(fam)
    call_id = answered_practice(client, fam)
    client.post(f"/api/calls/{call_id}/end", json={"ended_by": "user"})
    online(client, sara)
    assert client.post("/api/practice-calls", json={"target_member_id": sara}).status_code == 201


def test_practice_phone_offline_when_never_seen(client, make_family, fakes):
    sara, _ = ids(make_family())
    response = client.post("/api/practice-calls", json={"target_member_id": sara})
    assert response.status_code == 409
    assert error_code(response) == "phone_offline"


def test_practice_phone_offline_when_last_seen_older_than_ten_seconds(client, make_family, fakes):
    sara, _ = ids(make_family())
    set_member(sara, last_seen_at=ago(30))
    response = client.post("/api/practice-calls", json={"target_member_id": sara})
    assert response.status_code == 409
    assert error_code(response) == "phone_offline"


def test_practice_online_when_last_seen_within_ten_seconds(client, make_family, fakes):
    sara, _ = ids(make_family())
    set_member(sara, last_seen_at=ago(6))
    assert client.post("/api/practice-calls", json={"target_member_id": sara}).status_code == 201


def test_gate_order_consent_before_phone_offline(client, make_family, fakes):
    sara, _ = ids(make_family(consent=False))
    response = client.post("/api/practice-calls", json={"target_member_id": sara})
    assert error_code(response) == "consent_missing"


def test_gate_order_voice_before_busy(client, make_family, fakes):
    fam = make_family()
    sara, jon = ids(fam)
    start_practice(client, fam, voice=False)
    # Jon has no voice, and Sara is busy: voice_not_ready comes first.
    response = client.post("/api/practice-calls", json={"target_member_id": sara, "voice_member_id": jon})
    assert error_code(response) == "voice_not_ready"


def test_gate_order_busy_before_phone_offline(client, make_family, fakes):
    fam = make_family()
    sara, _ = ids(fam)
    start_practice(client, fam, voice=False)
    set_member(sara, last_seen_at=ago(60))
    response = client.post("/api/practice-calls", json={"target_member_id": sara})
    assert error_code(response) == "busy"


def test_practice_validation_errors_are_422(client, make_family, fakes):
    sara, _ = ids(make_family())
    online(client, sara)
    for bad in ({"scenario": "pirates"}, {"difficulty": 4}, {"difficulty": 0}, {"delay_seconds": -1}):
        response = client.post("/api/practice-calls", json={"target_member_id": sara, **bad})
        assert response.status_code == 422, bad
        assert "error" in response.json()


def test_practice_created_ringing_with_brief_stored(client, make_family, fakes):
    fam = make_family()
    sara, jon = ids(fam)
    call_id = start_practice(client, fam, difficulty=3)
    data = row(call_id)
    assert data["kind"] == "practice"
    assert data["status"] == "ringing"
    assert data["target_member_id"] == sara
    assert data["voice_member_id"] == jon
    assert data["scenario"] == "relative_new_number"
    assert data["difficulty"] == 3
    assert data["family_id"] == fam["family_id"]
    assert json.loads(data["brief_json"]) == {
        "target_name": "Sara", "difficulty": 3, "scenario": "relative_new_number"}
    assert data["caller_label"] == "Unknown number"
    assert data["caller_number"] == "+00 600 555 0142"
    assert data["scheduled_for"] is None
    assert fakes.briefs == [{"target": sara, "voice": jon, "scenario": "relative_new_number", "difficulty": 3}]


def test_practice_response_body(client, make_family, fakes):
    fam = make_family()
    sara, _ = ids(fam)
    online(client, sara)
    response = client.post("/api/practice-calls", json={"target_member_id": sara})
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "ringing"
    assert body["call_id"].startswith("call_")


def test_practice_with_library_voice_has_no_voice_member(client, make_family, fakes):
    fam = make_family()
    call_id = start_practice(client, fam, voice=False, scenario="police")
    data = row(call_id)
    assert data["voice_member_id"] is None
    assert data["scenario"] == "police"


def test_practice_defaults_when_only_target_given(client, make_family, fakes):
    sara, _ = ids(make_family())
    online(client, sara)
    call_id = client.post("/api/practice-calls", json={"target_member_id": sara}).json()["call_id"]
    data = row(call_id)
    assert data["scenario"] == "relative_new_number"
    assert data["difficulty"] == 1


def test_practice_ringing_publishes_call_status(client, make_family, fakes):
    call_id = start_practice(client, make_family())
    assert statuses(call_id) == ["ringing"]


def test_practice_with_delay_is_scheduled(client, make_family, fakes):
    fam = make_family()
    sara, _ = ids(fam)
    before = utcnow()
    call_id = start_practice(client, fam, delay_seconds=120)
    data = row(call_id)
    assert client.post("/api/practice-calls", json={"target_member_id": sara, "delay_seconds": 5}).status_code == 201
    assert data["status"] == "scheduled"
    due = parse_time(data["scheduled_for"])
    assert before + timedelta(seconds=115) <= due <= utcnow() + timedelta(seconds=125)
    assert json.loads(data["brief_json"])["target_name"] == "Sara"


def test_scheduled_call_is_not_shown_on_the_phone(client, make_family, fakes):
    fam = make_family()
    sara, _ = ids(fam)
    start_practice(client, fam, delay_seconds=120)
    assert client.get(f"/api/members/{sara}/phone-state").json()["incoming_call"] is None


def test_brief_is_built_without_holding_a_write_lock(client, make_family, fakes):
    # the fake brief probes with a second connection and would raise otherwise
    start_practice(client, make_family())


def test_busy_is_rechecked_after_the_brief_is_built(client, make_family, fakes):
    fam = make_family()
    sara, _ = ids(fam)
    online(client, sara)
    from app.ids import new_call_id

    def sneak_in_a_ringing_call() -> None:
        with new_session() as db:
            db.add(Call(id=new_call_id(), family_id=fam["family_id"], kind="welcome",
                        target_member_id=sara, status="ringing", difficulty=1, created_at=now_iso(),
                        ring_at=now_iso()))
            db.commit()

    fakes.brief_hook = sneak_in_a_ringing_call
    response = client.post("/api/practice-calls", json={"target_member_id": sara})
    assert response.status_code == 409
    assert error_code(response) == "busy"
    with new_session() as db:
        practices = db.scalars(select(Call).where(Call.kind == "practice")).all()
        assert practices == []


# ---------------------------------------------------------------- interface functions


def test_check_practice_gate_returns_members_and_raises_codes(client, make_family, fakes):
    from app.routers.calls import check_practice_gate

    sara, jon = ids(make_family())
    give_voice(jon)
    with new_session() as db:
        with pytest.raises(ApiError) as caught:
            check_practice_gate(db, sara, jon)  # phone offline
        assert (caught.value.status_code, caught.value.code) == (409, "phone_offline")
        target, voice = check_practice_gate(db, sara, jon, check_phone_online=False)
        assert target.id == sara and voice.id == jon
        target, voice = check_practice_gate(db, sara, None, check_phone_online=False)
        assert voice is None
        with pytest.raises(ApiError) as caught:
            check_practice_gate(db, "mem_nope", None, check_phone_online=False)
        assert (caught.value.status_code, caught.value.code) == (404, "not_found")


def test_create_practice_without_phone_check_creates_ringing_call(client, make_family, fakes):
    from app.routers.calls import create_practice

    sara, jon = ids(make_family())
    give_voice(jon)

    async def run():
        with new_session() as db:
            return await create_practice(db, sara, jon, "bank_security", 2, 0, check_phone_online=False)

    call = asyncio.run(run())
    data = row(call.id)
    assert data["status"] == "ringing"
    assert data["scenario"] == "bank_security"
    assert statuses(call.id) == ["ringing"]


def test_create_practice_with_phone_check_raises_phone_offline(client, make_family, fakes):
    from app.routers.calls import create_practice

    sara, _ = ids(make_family())

    async def run():
        with new_session() as db:
            await create_practice(db, sara, None, "police", 1, 0)

    with pytest.raises(ApiError) as caught:
        asyncio.run(run())
    assert caught.value.code == "phone_offline"


def test_create_practice_with_delay_returns_scheduled_call(client, make_family, fakes):
    from app.routers.calls import create_practice

    sara, _ = ids(make_family())

    async def run():
        with new_session() as db:
            return await create_practice(db, sara, None, "hospital", 1, 90, check_phone_online=False)

    call = asyncio.run(run())
    data = row(call.id)
    assert data["status"] == "scheduled"
    assert data["scheduled_for"] is not None
    assert statuses(call.id) == []  # nothing rings yet


# ================================================================ phone state


def test_phone_state_unknown_member_404(client):
    response = client.get("/api/members/mem_nope/phone-state")
    assert response.status_code == 404
    assert error_code(response) == "not_found"


def test_phone_state_idle_shape(client, make_family):
    fam = make_family()
    sara, _ = ids(fam)
    body = client.get(f"/api/members/{sara}/phone-state").json()
    assert body["member"] == {"id": sara, "name": "Sara", "family": "The Kovacs"}
    assert body["incoming_call"] is None
    assert body["messages"] == []
    assert body["family_number"]["enabled"] in (True, False)


def test_phone_state_records_last_seen_and_marks_online(client, make_family):
    fam = make_family()
    sara, _ = ids(fam)
    with new_session() as db:
        assert db.get(Member, sara).last_seen_at is None
    online(client, sara)
    with new_session() as db:
        seen = parse_time(db.get(Member, sara).last_seen_at)
    assert abs((utcnow() - seen).total_seconds()) < 5
    family = client.get(f"/api/families/{fam['family_id']}").json()
    by_id = {m["id"]: m for m in family["members"]}
    assert by_id[sara]["phone_online"] is True


def test_phone_state_shows_ringing_practice_call(client, make_family, fakes):
    fam = make_family()
    sara, _ = ids(fam)
    call_id = start_practice(client, fam)
    incoming = client.get(f"/api/members/{sara}/phone-state").json()["incoming_call"]
    assert incoming["call_id"] == call_id
    assert incoming["kind"] == "practice"
    assert incoming["caller"] == {"label": "Unknown number", "number": "+00 600 555 0142"}


def test_phone_state_hides_call_once_answered_declined_or_missed(client, make_family, fakes):
    fam = make_family()
    sara, _ = ids(fam)
    call_id = start_practice(client, fam)
    client.post(f"/api/calls/{call_id}/answer")
    assert client.get(f"/api/members/{sara}/phone-state").json()["incoming_call"] is None
    for status in ("declined", "missed", "ended", "failed"):
        set_call(call_id, status=status)
        assert client.get(f"/api/members/{sara}/phone-state").json()["incoming_call"] is None


def test_phone_state_does_not_show_another_members_call(client, make_family, fakes):
    fam = make_family()
    sara, jon = ids(fam)
    start_practice(client, fam, voice=False)
    assert client.get(f"/api/members/{jon}/phone-state").json()["incoming_call"] is None


def test_phone_state_shows_unread_messages_only(client, make_family):
    fam = make_family()
    sara, jon = ids(fam)
    with new_session() as db:
        db.add_all([
            Message(member_id=sara, kind="weekly", text="This week", created_at=now_iso()),
            Message(member_id=sara, kind="reminder", text="Old", created_at=now_iso(), read_at=now_iso()),
            Message(member_id=jon, kind="weekly", text="Not hers", created_at=now_iso()),
        ])
        db.commit()
    messages = client.get(f"/api/members/{sara}/phone-state").json()["messages"]
    assert [m["text"] for m in messages] == ["This week"]
    assert messages[0]["kind"] == "weekly"
    assert isinstance(messages[0]["id"], int)
    assert messages[0]["created_at"]


def test_messages_read_marks_given_ids_only(client, make_family):
    sara, _ = ids(make_family())
    with new_session() as db:
        first = Message(member_id=sara, kind="weekly", text="one", created_at=now_iso())
        second = Message(member_id=sara, kind="reminder", text="two", created_at=now_iso())
        db.add_all([first, second])
        db.commit()
        first_id, second_id = first.id, second.id
    response = client.post(f"/api/members/{sara}/messages/read", json={"ids": [first_id]})
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    messages = client.get(f"/api/members/{sara}/phone-state").json()["messages"]
    assert [m["id"] for m in messages] == [second_id]


def test_messages_read_without_ids_marks_all(client, make_family):
    sara, _ = ids(make_family())
    with new_session() as db:
        db.add_all([Message(member_id=sara, kind="weekly", text=str(i), created_at=now_iso()) for i in range(3)])
        db.commit()
    assert client.post(f"/api/members/{sara}/messages/read", json={}).status_code == 200
    assert client.get(f"/api/members/{sara}/phone-state").json()["messages"] == []
    with new_session() as db:
        assert all(m.read_at for m in db.scalars(select(Message)).all())


def test_messages_read_unknown_member_404(client):
    response = client.post("/api/members/mem_nope/messages/read", json={})
    assert response.status_code == 404


# ================================================================ welcome call


def test_welcome_call_rings_the_members_phone(client, make_family, fakes):
    fam = make_family(consent=False)  # the welcome call is where consent is asked
    sara, _ = ids(fam)
    online(client, sara)
    response = client.post(f"/api/members/{sara}/welcome-call")
    assert response.status_code in (200, 201)
    call_id = response.json()["call_id"]
    data = row(call_id)
    assert data["kind"] == "welcome"
    assert data["status"] == "ringing"
    assert data["target_member_id"] == sara
    assert data["voice_member_id"] is None
    assert statuses(call_id) == ["ringing"]
    incoming = client.get(f"/api/members/{sara}/phone-state").json()["incoming_call"]
    assert incoming["call_id"] == call_id
    assert incoming["kind"] == "welcome"
    assert incoming["caller"]["label"] and incoming["caller"]["number"]


def test_welcome_call_unknown_member_404(client, fakes):
    assert client.post("/api/members/mem_nope/welcome-call").status_code == 404


def test_welcome_call_phone_offline_409(client, make_family, fakes):
    sara, _ = ids(make_family())
    response = client.post(f"/api/members/{sara}/welcome-call")
    assert response.status_code == 409
    assert error_code(response) == "phone_offline"


def test_welcome_call_busy_409(client, make_family, fakes):
    fam = make_family()
    sara, _ = ids(fam)
    start_practice(client, fam, voice=False)
    response = client.post(f"/api/members/{sara}/welcome-call")
    assert response.status_code == 409
    assert error_code(response) == "busy"


def test_welcome_call_answer_returns_welcome_session(client, make_family, fakes):
    sara, _ = ids(make_family())
    online(client, sara)
    call_id = client.post(f"/api/members/{sara}/welcome-call").json()["call_id"]
    response = client.post(f"/api/calls/{call_id}/answer")
    assert response.status_code == 200
    assert response.json()["kind"] == "welcome"


# ================================================================ answer / decline


def test_answer_moves_call_to_in_progress_and_returns_session(client, make_family, fakes):
    call_id = start_practice(client, make_family())
    response = client.post(f"/api/calls/{call_id}/answer")
    assert response.status_code == 200
    body = response.json()
    assert body["kind"] == "practice"
    assert body["conversation_token"] == "tok_fake"
    assert body["conversation_id"] == f"conv_{call_id}"
    assert body["max_seconds"] == 150
    data = row(call_id)
    assert data["status"] == "in_progress"
    assert data["conversation_id"] == f"conv_{call_id}"
    answered = parse_time(data["answered_at"])
    assert abs((utcnow() - answered).total_seconds()) < 5
    assert statuses(call_id) == ["ringing", "in_progress"]
    assert fakes.sessions == [call_id]


def test_answer_commits_state_before_building_the_session(client, make_family, fakes):
    call_id = start_practice(client, make_family())
    client.post(f"/api/calls/{call_id}/answer")
    assert fakes.seen[0]["status"] == "in_progress"
    assert fakes.seen[0]["answered_at"] is not None


def test_answer_twice_is_409(client, make_family, fakes):
    call_id = start_practice(client, make_family())
    assert client.post(f"/api/calls/{call_id}/answer").status_code == 200
    assert client.post(f"/api/calls/{call_id}/answer").status_code == 409
    assert fakes.sessions == [call_id]


@pytest.mark.parametrize("status", ["scheduled", "declined", "missed", "ended", "scored", "failed"])
def test_answer_when_not_ringing_is_409(client, make_family, fakes, status):
    call_id = start_practice(client, make_family())
    set_call(call_id, status=status)
    response = client.post(f"/api/calls/{call_id}/answer")
    assert response.status_code == 409
    assert "code" in response.json()["error"]
    assert fakes.sessions == []


def test_answer_unknown_call_404(client, fakes):
    assert client.post("/api/calls/call_nope/answer").status_code == 404


def test_answer_token_failure_marks_call_failed(client, make_family, fakes):
    from app.services.elevenlabs import ElevenLabsError

    fakes.session_error = ElevenLabsError("token failed")
    call_id = start_practice(client, make_family())
    response = client.post(f"/api/calls/{call_id}/answer")
    assert response.status_code >= 400
    assert row(call_id)["status"] == "failed"
    assert statuses(call_id)[-1] == "failed"


def test_decline_ringing_call(client, make_family, fakes):
    fam = make_family()
    sara, _ = ids(fam)
    call_id = start_practice(client, fam)
    response = client.post(f"/api/calls/{call_id}/decline")
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert row(call_id)["status"] == "declined"
    assert statuses(call_id) == ["ringing", "declined"]
    assert client.get(f"/api/members/{sara}/phone-state").json()["incoming_call"] is None


def test_decline_frees_the_target_for_a_new_practice(client, make_family, fakes):
    fam = make_family()
    sara, _ = ids(fam)
    call_id = start_practice(client, fam)
    client.post(f"/api/calls/{call_id}/decline")
    online(client, sara)
    assert client.post("/api/practice-calls", json={"target_member_id": sara}).status_code == 201


@pytest.mark.parametrize("status", ["in_progress", "ended", "declined", "missed"])
def test_decline_when_not_ringing_is_409(client, make_family, fakes, status):
    call_id = start_practice(client, make_family())
    set_call(call_id, status=status)
    assert client.post(f"/api/calls/{call_id}/decline").status_code == 409
    assert row(call_id)["status"] == status


def test_decline_unknown_call_404(client):
    assert client.post("/api/calls/call_nope/decline").status_code == 404


# ================================================================ events


def test_events_batch_is_stored_in_order_with_labels(client, make_family, fakes):
    call_id = answered_practice(client, make_family())
    batch = {"events": [
        {"type": "turn", "speaker": "agent", "text": "Mum? It's me."},
        {"type": "tactic", "key": "new_number"},
        {"type": "turn", "speaker": "user", "text": "Jon? What is our family word?"},
        {"type": "outcome", "outcome": "asked_safe_word"},
        {"type": "revealed"},
    ]}
    response = client.post(f"/api/calls/{call_id}/events", json=batch)
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    stored = stored_events(call_id)
    # ringing, in_progress, then our five
    assert [e["seq"] for e in stored] == list(range(1, 8))
    ours = stored[2:]
    assert [e["type"] for e in ours] == ["turn", "tactic", "turn", "outcome", "revealed"]
    assert ours[0]["data"]["speaker"] == "agent" and ours[0]["data"]["text"] == "Mum? It's me."
    assert ours[1]["data"]["key"] == "new_number"
    assert ours[1]["data"]["label"] == TACTIC_LABELS["new_number"]
    assert ours[3]["data"]["outcome"] == "asked_safe_word"
    assert all(e["t"] is not None and e["t"] >= 0 for e in ours)


def test_every_tactic_gets_its_label(client, make_family, fakes):
    call_id = answered_practice(client, make_family())
    keys = list(schemas.TACTICS)
    client.post(f"/api/calls/{call_id}/events", json={"events": [{"type": "tactic", "key": k} for k in keys]})
    tactic_events = [e for e in stored_events(call_id) if e["type"] == "tactic"]
    assert [e["data"]["label"] for e in tactic_events] == [TACTIC_LABELS[k] for k in keys]


def test_unknown_tactic_key_is_422_and_nothing_is_stored(client, make_family, fakes):
    call_id = answered_practice(client, make_family())
    before = len(stored_events(call_id))
    response = client.post(f"/api/calls/{call_id}/events", json={"events": [
        {"type": "turn", "speaker": "agent", "text": "hello"},
        {"type": "tactic", "key": "flattery"},
    ]})
    assert response.status_code == 422
    assert "error" in response.json()
    assert len(stored_events(call_id)) == before


def test_unknown_outcome_is_422(client, make_family, fakes):
    call_id = answered_practice(client, make_family())
    response = client.post(f"/api/calls/{call_id}/events",
                           json={"events": [{"type": "outcome", "outcome": "paid_up"}]})
    assert response.status_code == 422


@pytest.mark.parametrize("event", [
    {"type": "dance"},
    {"type": "turn", "speaker": "robot", "text": "hi"},
    {"type": "turn", "speaker": "agent", "text": ""},
    {"type": "turn", "speaker": "agent"},
    {"type": "consent"},
])
def test_malformed_events_are_422(client, make_family, fakes, event):
    call_id = answered_practice(client, make_family())
    assert client.post(f"/api/calls/{call_id}/events", json={"events": [event]}).status_code == 422


def test_empty_and_oversized_batches_are_422(client, make_family, fakes):
    call_id = answered_practice(client, make_family())
    assert client.post(f"/api/calls/{call_id}/events", json={"events": []}).status_code == 422
    many = [{"type": "revealed"}] * 101
    assert client.post(f"/api/calls/{call_id}/events", json={"events": many}).status_code == 422
    exactly = [{"type": "turn", "speaker": "user", "text": f"line {i}"} for i in range(100)]
    assert client.post(f"/api/calls/{call_id}/events", json={"events": exactly}).status_code == 200


def test_events_unknown_call_404(client):
    response = client.post("/api/calls/call_nope/events", json={"events": [{"type": "revealed"}]})
    assert response.status_code == 404
    assert error_code(response) == "not_found"


def test_event_t_is_seconds_since_answered_at(client, make_family, fakes):
    call_id = answered_practice(client, make_family())
    set_call(call_id, answered_at=ago(12))
    client.post(f"/api/calls/{call_id}/events",
                json={"events": [{"type": "turn", "speaker": "agent", "text": "hello"}]})
    event = [e for e in stored_events(call_id) if e["type"] == "turn"][0]
    assert 11.5 <= event["t"] <= 16


def test_first_outcome_carries_seconds_to_challenge(client, make_family, fakes):
    call_id = answered_practice(client, make_family())
    set_call(call_id, answered_at=ago(12))
    client.post(f"/api/calls/{call_id}/events",
                json={"events": [{"type": "outcome", "outcome": "asked_safe_word"}]})
    event = [e for e in stored_events(call_id) if e["type"] == "outcome"][0]
    assert event["data"]["outcome"] == "asked_safe_word"
    assert 11.5 <= event["data"]["seconds_to_challenge"] <= 16


def test_second_outcome_does_not_restart_seconds_to_challenge(client, make_family, fakes):
    call_id = answered_practice(client, make_family())
    set_call(call_id, answered_at=ago(12))
    client.post(f"/api/calls/{call_id}/events", json={"events": [{"type": "outcome", "outcome": "hesitated"}]})
    set_call(call_id, answered_at=ago(40))
    client.post(f"/api/calls/{call_id}/events", json={"events": [{"type": "outcome", "outcome": "agreed"}]})
    outcomes = [e for e in stored_events(call_id) if e["type"] == "outcome"]
    assert outcomes[0]["data"]["seconds_to_challenge"] <= 16
    assert outcomes[1]["data"].get("seconds_to_challenge") is None


def test_two_outcomes_in_one_batch_only_first_gets_seconds(client, make_family, fakes):
    call_id = answered_practice(client, make_family())
    client.post(f"/api/calls/{call_id}/events", json={"events": [
        {"type": "outcome", "outcome": "asked_safe_word"},
        {"type": "outcome", "outcome": "agreed"},
    ]})
    outcomes = [e for e in stored_events(call_id) if e["type"] == "outcome"]
    assert outcomes[0]["data"]["seconds_to_challenge"] is not None
    assert outcomes[1]["data"].get("seconds_to_challenge") is None


def test_consent_event_given_true_sets_consent_and_writes_row(client, make_family, fakes):
    fam = make_family(consent=False)
    sara, _ = ids(fam)
    online(client, sara)
    call_id = client.post(f"/api/members/{sara}/welcome-call").json()["call_id"]
    client.post(f"/api/calls/{call_id}/answer")
    response = client.post(f"/api/calls/{call_id}/events", json={"events": [{"type": "consent", "given": True}]})
    assert response.status_code == 200
    with new_session() as db:
        member = db.get(Member, sara)
        assert member.consent_practice_at is not None
        rows = db.scalars(select(Consent).where(Consent.member_id == sara)).all()
        assert len(rows) == 1
        assert rows[0].kind == "practice"
        assert rows[0].source == "welcome_call"
        assert rows[0].call_id == call_id
    assert any(e["type"] == "consent" and e["data"]["given"] is True for e in stored_events(call_id))
    # and the member can now be practised on
    online(client, sara)
    client.post(f"/api/calls/{call_id}/end", json={"ended_by": "agent"})
    assert client.post("/api/practice-calls", json={"target_member_id": sara}).status_code == 201


def test_consent_event_given_false_changes_nothing(client, make_family, fakes):
    fam = make_family(consent=False)
    sara, _ = ids(fam)
    online(client, sara)
    call_id = client.post(f"/api/members/{sara}/welcome-call").json()["call_id"]
    client.post(f"/api/calls/{call_id}/answer")
    assert client.post(f"/api/calls/{call_id}/events",
                       json={"events": [{"type": "consent", "given": False}]}).status_code == 200
    with new_session() as db:
        assert db.get(Member, sara).consent_practice_at is None
        assert db.scalars(select(Consent).where(Consent.member_id == sara)).all() == []


def test_get_call_shows_turns_and_tactics_from_events(client, make_family, fakes):
    call_id = answered_practice(client, make_family())
    set_call(call_id, answered_at=ago(5))
    client.post(f"/api/calls/{call_id}/events", json={"events": [
        {"type": "turn", "speaker": "agent", "text": "Mum? It's me."},
        {"type": "tactic", "key": "urgency"},
        {"type": "turn", "speaker": "user", "text": "Who is this?"},
    ]})
    body = client.get(f"/api/calls/{call_id}").json()
    assert [(t["speaker"], t["text"]) for t in body["turns"]] == [("agent", "Mum? It's me."), ("user", "Who is this?")]
    assert all(t["t"] is not None for t in body["turns"])
    assert [(t["key"], t["label"]) for t in body["tactics"]] == [("urgency", TACTIC_LABELS["urgency"])]
    assert body["tactics"][0]["t"] is not None


# ================================================================ end


def test_end_sets_ended_state_and_publishes(client, make_family, fakes):
    call_id = answered_practice(client, make_family())
    response = client.post(f"/api/calls/{call_id}/end", json={"ended_by": "user"})
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    data = row(call_id)
    assert data["status"] == "ended"
    assert data["ended_by"] == "user"
    assert abs((utcnow() - parse_time(data["ended_at"])).total_seconds()) < 5
    assert statuses(call_id) == ["ringing", "in_progress", "ended"]


@pytest.mark.parametrize("ended_by", ["agent", "user", "timeout", "error"])
def test_end_accepts_each_ended_by(client, make_family, fakes, ended_by):
    call_id = answered_practice(client, make_family())
    assert client.post(f"/api/calls/{call_id}/end", json={"ended_by": ended_by}).status_code == 200
    assert row(call_id)["ended_by"] == ended_by


def test_end_rejects_bad_ended_by(client, make_family, fakes):
    call_id = answered_practice(client, make_family())
    assert client.post(f"/api/calls/{call_id}/end", json={"ended_by": "alien"}).status_code == 422
    assert client.post(f"/api/calls/{call_id}/end", json={}).status_code == 422
    assert row(call_id)["status"] == "in_progress"


def test_end_unknown_call_404(client):
    assert client.post("/api/calls/call_nope/end", json={"ended_by": "user"}).status_code == 404


def _wait_for(predicate, seconds: float = 3.0) -> bool:
    deadline = time.time() + seconds
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return predicate()


def test_end_starts_after_call_in_the_background(client, make_family, fakes):
    call_id = answered_practice(client, make_family())
    client.post(f"/api/calls/{call_id}/end", json={"ended_by": "agent"})
    assert _wait_for(lambda: fakes.after == [call_id])


def test_end_answers_before_after_call_finishes(client, make_family, fakes):
    fakes.after_delay = 1.5
    call_id = answered_practice(client, make_family())
    started = time.time()
    response = client.post(f"/api/calls/{call_id}/end", json={"ended_by": "agent"})
    assert response.status_code == 200
    assert time.time() - started < 1.0


@pytest.mark.parametrize("error", [NotImplementedError("stub"), RuntimeError("boom")])
def test_end_survives_a_failing_after_call(client, make_family, fakes, error):
    fakes.after_error = error
    call_id = answered_practice(client, make_family())
    response = client.post(f"/api/calls/{call_id}/end", json={"ended_by": "agent"})
    assert response.status_code == 200
    assert _wait_for(lambda: fakes.after == [call_id])
    assert row(call_id)["status"] == "ended"
    assert client.get(f"/api/calls/{call_id}").status_code == 200


def test_end_twice_runs_after_call_once_and_keeps_first_ended_by(client, make_family, fakes):
    call_id = answered_practice(client, make_family())
    client.post(f"/api/calls/{call_id}/end", json={"ended_by": "agent"})
    second = client.post(f"/api/calls/{call_id}/end", json={"ended_by": "user"})
    assert second.status_code in (200, 409)
    _wait_for(lambda: len(fakes.after) >= 1)
    time.sleep(0.3)
    assert fakes.after == [call_id]
    assert row(call_id)["ended_by"] == "agent"
    assert statuses(call_id).count("ended") == 1


def test_end_of_a_ringing_call_does_not_corrupt_state(client, make_family, fakes):
    call_id = start_practice(client, make_family())
    response = client.post(f"/api/calls/{call_id}/end", json={"ended_by": "user"})
    assert response.status_code in (200, 409)
    assert row(call_id)["status"] in ("ringing", "ended")


# ================================================================ GET /calls/{id}


def test_get_call_unknown_404(client):
    response = client.get("/api/calls/call_nope")
    assert response.status_code == 404
    assert error_code(response) == "not_found"


def test_get_call_object_shape_for_practice(client, make_family, fakes):
    fam = make_family()
    sara, jon = ids(fam)
    call_id = start_practice(client, fam, difficulty=2)
    body = client.get(f"/api/calls/{call_id}").json()
    assert body["id"] == call_id
    assert body["kind"] == "practice"
    assert body["status"] == "ringing"
    assert body["target"] == {"id": sara, "name": "Sara"}
    assert body["voice_of"] == {"id": jon, "name": "Jon"}
    assert body["scenario"] == "relative_new_number"
    assert body["difficulty"] == 2
    assert body["caller_label"] == "Unknown number"
    assert body["turns"] == []
    assert body["tactics"] == []
    assert body["result"] is None
    assert body["callback_seconds"] is None


def test_get_call_with_library_voice_has_null_voice_of(client, make_family, fakes):
    call_id = start_practice(client, make_family(), voice=False)
    assert client.get(f"/api/calls/{call_id}").json()["voice_of"] is None


def test_get_call_timestamps_after_end(client, make_family, fakes):
    call_id = answered_practice(client, make_family())
    client.post(f"/api/calls/{call_id}/end", json={"ended_by": "timeout"})
    body = client.get(f"/api/calls/{call_id}").json()
    assert body["status"] == "ended"
    assert body["ended_by"] == "timeout"
    assert body["answered_at"] and body["ended_at"]


def test_get_call_result_only_once_scored(client, make_family, fakes):
    call_id = ended_practice(client, make_family())
    assert client.get(f"/api/calls/{call_id}").json()["result"] is None
    with new_session() as db:
        db.add(Result(call_id=call_id, outcome="asked_safe_word", seconds_to_challenge=9.5,
                      tactics_used_json=json.dumps(["urgency", "secrecy"]),
                      tactics_worked_json=json.dumps(["urgency"]),
                      lesson="Ask for the family word.", debrief="Good.", created_at=now_iso()))
        db.commit()
    set_call(call_id, status="scored")
    body = client.get(f"/api/calls/{call_id}").json()
    assert body["status"] == "scored"
    assert body["result"]["outcome"] == "asked_safe_word"
    assert body["result"]["seconds_to_challenge"] == 9.5
    assert body["result"]["lesson"] == "Ask for the family word."
    assert body["result"]["debrief"] == "Good."
    assert body["result"]["tactics_used"] == ["urgency", "secrecy"]
    assert body["result"]["tactics_worked"] == ["urgency"]


# ================================================================ family line


def tap_family_line(client, member_id: str):
    return client.post(f"/api/members/{member_id}/family-line")


def test_family_line_unknown_member_404(client, fakes):
    assert tap_family_line(client, "mem_nope").status_code == 404


def test_family_line_without_any_practice_is_404_no_recent_practice(client, make_family, fakes):
    sara, _ = ids(make_family())
    response = tap_family_line(client, sara)
    assert response.status_code == 404
    assert error_code(response) == "no_recent_practice"


def test_family_line_practice_older_than_ten_minutes_is_404(client, make_family, fakes):
    fam = make_family()
    sara, _ = ids(fam)
    ended_practice(client, fam, ended_ago=11 * 60)
    response = tap_family_line(client, sara)
    assert response.status_code == 404
    assert error_code(response) == "no_recent_practice"


def test_family_line_practice_still_running_does_not_count(client, make_family, fakes):
    fam = make_family()
    sara, _ = ids(fam)
    answered_practice(client, fam)
    assert error_code(tap_family_line(client, sara)) == "no_recent_practice"


def test_family_line_declined_or_welcome_calls_do_not_count(client, make_family, fakes):
    fam = make_family()
    sara, _ = ids(fam)
    declined = start_practice(client, fam)
    client.post(f"/api/calls/{declined}/decline")
    online(client, sara)
    welcome = client.post(f"/api/members/{sara}/welcome-call").json()["call_id"]
    client.post(f"/api/calls/{welcome}/answer")
    client.post(f"/api/calls/{welcome}/end", json={"ended_by": "agent"})
    assert error_code(tap_family_line(client, sara)) == "no_recent_practice"


def test_family_line_practice_of_another_member_does_not_count(client, make_family, fakes):
    fam = make_family()
    _, jon = ids(fam)
    ended_practice(client, fam)  # Sara's practice
    assert error_code(tap_family_line(client, jon)) == "no_recent_practice"


def test_family_line_creates_call_and_returns_session(client, make_family, fakes):
    fam = make_family()
    sara, _ = ids(fam)
    practice = ended_practice(client, fam, ended_ago=20)
    response = tap_family_line(client, sara)
    assert response.status_code in (200, 201)
    body = response.json()
    assert body["session"]["kind"] == "family_line"
    assert body["session"]["max_seconds"] == 60
    data = row(body["call_id"])
    assert data["kind"] == "family_line"
    assert data["parent_call_id"] == practice
    assert data["target_member_id"] == sara
    assert data["family_id"] == fam["family_id"]
    assert data["status"] == "in_progress"
    assert abs((utcnow() - parse_time(data["answered_at"])).total_seconds()) < 5
    assert fakes.sessions[-1] == body["call_id"]


def test_family_line_picks_the_latest_practice(client, make_family, fakes):
    fam = make_family()
    sara, _ = ids(fam)
    older = ended_practice(client, fam, ended_ago=300)
    newer = ended_practice(client, fam, ended_ago=30)
    body = tap_family_line(client, sara).json()
    assert row(body["call_id"])["parent_call_id"] == newer
    assert row(older)["callback_seconds"] is None


def test_family_line_works_for_a_scored_practice(client, make_family, fakes):
    fam = make_family()
    sara, _ = ids(fam)
    practice = ended_practice(client, fam)
    set_call(practice, status="scored")
    assert tap_family_line(client, sara).status_code in (200, 201)


def test_family_line_stores_callback_seconds_on_the_practice(client, make_family, fakes):
    fam = make_family()
    sara, _ = ids(fam)
    practice = ended_practice(client, fam, ended_ago=20)
    tap_family_line(client, sara)
    seconds = row(practice)["callback_seconds"]
    assert 19.5 <= seconds <= 30
    assert client.get(f"/api/calls/{practice}").json()["callback_seconds"] == seconds


def test_family_line_publishes_callback_connected_on_the_practice_stream(client, make_family, fakes):
    fam = make_family()
    sara, _ = ids(fam)
    practice = ended_practice(client, fam, ended_ago=20)
    tap_family_line(client, sara)
    connected = [e for e in stored_events(practice) if e["type"] == "callback.connected"]
    assert len(connected) == 1
    assert 19.5 <= connected[0]["data"]["seconds"] <= 30


def test_family_line_commits_callback_seconds_before_building_the_session(client, make_family, fakes):
    fam = make_family()
    sara, _ = ids(fam)
    ended_practice(client, fam, ended_ago=20)
    tap_family_line(client, sara)
    seen = fakes.seen[-1]
    assert seen["status"] == "in_progress"
    assert seen["parent_callback_seconds"] is not None


def test_family_line_notice_goes_to_the_voice_owner(client, make_family, fakes):
    fam = make_family()
    sara, jon = ids(fam)
    ended_practice(client, fam)  # voice of Jon
    tap_family_line(client, sara)
    messages = client.get(f"/api/members/{jon}/phone-state").json()["messages"]
    assert len(messages) == 1
    assert messages[0]["kind"] == "callback_notice"
    assert "Sara" in messages[0]["text"]
    assert client.get(f"/api/members/{sara}/phone-state").json()["messages"] == []


def test_family_line_notice_goes_to_the_organiser_for_a_library_voice(client, make_family, fakes):
    fam = make_family()
    sara, jon = ids(fam)  # Jon is the organiser
    ended_practice(client, fam, voice=False, scenario="police")
    tap_family_line(client, sara)
    messages = client.get(f"/api/members/{jon}/phone-state").json()["messages"]
    assert [m["kind"] for m in messages] == ["callback_notice"]
    assert "Sara" in messages[0]["text"]


def _snapshots(member_id: str) -> list[ReadinessSnapshot]:
    with new_session() as db:
        rows = db.scalars(select(ReadinessSnapshot).where(ReadinessSnapshot.member_id == member_id)
                          .order_by(ReadinessSnapshot.id)).all()
        return [(r.id, json.loads(r.items_json), r.total, r.max, r.source_call_id) for r in rows]


def _add_result_and_snapshot(practice: str, member_id: str) -> None:
    items = [{"key": key, "score": 1} for key in schemas.READINESS_KEYS]
    with new_session() as db:
        db.add(Result(call_id=practice, outcome="hung_up", seconds_to_challenge=4.0,
                      tactics_used_json="[]", tactics_worked_json="[]", lesson="x", created_at=now_iso()))
        db.add(ReadinessSnapshot(member_id=member_id, source_call_id=practice, items_json=json.dumps(items),
                                 total=5, max=10, created_at=now_iso()))
        db.commit()
    set_call(practice, status="scored")


def test_family_line_with_result_updates_result_and_writes_snapshot(client, make_family, fakes):
    fam = make_family()
    sara, _ = ids(fam)
    practice = ended_practice(client, fam, ended_ago=20)
    _add_result_and_snapshot(practice, sara)
    before = _snapshots(sara)
    tap_family_line(client, sara)
    with new_session() as db:
        assert 19.5 <= db.get(Result, practice).callback_seconds <= 30
    after = _snapshots(sara)
    assert len(after) == len(before) + 1
    _, items, total, maximum, _ = after[-1]
    scores = {item["key"]: item["score"] for item in items}
    assert scores["trusted_contact"] == 2
    assert total == 6 and maximum == 10
    assert {k: v for k, v in scores.items() if k != "trusted_contact"} == {
        k: 1 for k in schemas.READINESS_KEYS if k != "trusted_contact"}


def test_family_line_after_more_than_a_minute_does_not_raise_trusted_contact(client, make_family, fakes):
    fam = make_family()
    sara, _ = ids(fam)
    practice = ended_practice(client, fam, ended_ago=100)
    _add_result_and_snapshot(practice, sara)
    tap_family_line(client, sara)
    with new_session() as db:
        assert db.get(Result, practice).callback_seconds >= 99
    _, items, total, _, _ = _snapshots(sara)[-1]
    assert {item["key"]: item["score"] for item in items}["trusted_contact"] == 1
    assert total == 5


def test_family_line_without_result_writes_no_snapshot(client, make_family, fakes):
    fam = make_family()
    sara, _ = ids(fam)
    ended_practice(client, fam)
    before = _snapshots(sara)
    tap_family_line(client, sara)
    assert _snapshots(sara) == before
    with new_session() as db:
        assert db.scalars(select(Result)).all() == []


# ================================================================ scheduler tick


def tick_now(now=None) -> None:
    from app.services.scheduler import tick

    async def run():
        with new_session() as db:
            await tick(db, now or utcnow())

    asyncio.run(run())


def scheduled_call(client, fam, **extra: Any) -> str:
    call_id = start_practice(client, fam, delay_seconds=300, **extra)
    set_call(call_id, scheduled_for=ago(1))
    return call_id


def test_tick_rings_a_due_scheduled_call(client, make_family, fakes):
    call_id = scheduled_call(client, make_family())
    tick_now()
    data = row(call_id)
    assert data["status"] == "ringing"
    assert data["ring_at"] is not None
    assert statuses(call_id) == ["ringing"]


def test_tick_leaves_a_future_scheduled_call(client, make_family, fakes):
    call_id = start_practice(client, make_family(), delay_seconds=300)
    tick_now()
    assert row(call_id)["status"] == "scheduled"
    assert statuses(call_id) == []


def test_tick_uses_the_now_it_is_given(client, make_family, fakes):
    call_id = start_practice(client, make_family(), delay_seconds=300)
    tick_now(utcnow() + timedelta(seconds=400))
    assert row(call_id)["status"] == "ringing"


def test_tick_rings_scheduled_call_even_if_phone_looks_offline(client, make_family, fakes):
    fam = make_family()
    sara, _ = ids(fam)
    call_id = scheduled_call(client, fam)
    set_member(sara, last_seen_at=ago(600))
    tick_now()
    assert row(call_id)["status"] == "ringing"


def test_tick_keeps_due_call_scheduled_while_target_is_busy(client, make_family, fakes):
    fam = make_family()
    sara, _ = ids(fam)
    call_id = scheduled_call(client, fam)
    online(client, sara)
    other = client.post(f"/api/members/{sara}/welcome-call").json()["call_id"]
    tick_now()
    assert row(call_id)["status"] == "scheduled"
    assert row(other)["status"] == "ringing"
    # once the target is free again, the next pass rings it
    set_call(other, status="declined")
    tick_now()
    assert row(call_id)["status"] == "ringing"


def test_tick_fails_due_call_when_consent_was_withdrawn(client, make_family, fakes):
    fam = make_family()
    sara, _ = ids(fam)
    call_id = scheduled_call(client, fam)
    set_member(sara, opted_out_at=now_iso())
    tick_now()
    assert row(call_id)["status"] == "failed"
    assert statuses(call_id)[-1] == "failed"


def test_tick_fails_due_call_when_the_voice_is_gone(client, make_family, fakes):
    fam = make_family()
    _, jon = ids(fam)
    call_id = scheduled_call(client, fam)
    set_member(jon, voice_status="deleted", voice_id=None)
    tick_now()
    assert row(call_id)["status"] == "failed"


def test_tick_marks_ringing_call_missed_after_45_seconds(client, make_family, fakes):
    fam = make_family()
    sara, _ = ids(fam)
    call_id = start_practice(client, fam)
    set_call(call_id, ring_at=ago(46))
    tick_now()
    assert row(call_id)["status"] == "missed"
    assert statuses(call_id)[-1] == "missed"
    assert client.get(f"/api/members/{sara}/phone-state").json()["incoming_call"] is None


def test_tick_keeps_ringing_call_before_45_seconds(client, make_family, fakes):
    call_id = start_practice(client, make_family())
    set_call(call_id, ring_at=ago(30))
    tick_now()
    assert row(call_id)["status"] == "ringing"


def test_tick_marks_a_welcome_call_missed_too(client, make_family, fakes):
    sara, _ = ids(make_family())
    online(client, sara)
    call_id = client.post(f"/api/members/{sara}/welcome-call").json()["call_id"]
    set_call(call_id, ring_at=ago(50))
    tick_now()
    assert row(call_id)["status"] == "missed"


def test_tick_ends_practice_after_max_seconds_plus_30(client, make_family, fakes):
    call_id = answered_practice(client, make_family())
    set_call(call_id, answered_at=ago(MAX_SECONDS["practice"] + 31))
    tick_now()
    data = row(call_id)
    assert data["status"] == "ended"
    assert data["ended_by"] == "timeout"
    assert data["ended_at"] is not None
    assert statuses(call_id)[-1] == "ended"


def test_tick_starts_after_call_for_a_timed_out_call(client, make_family, fakes):
    call_id = answered_practice(client, make_family())
    set_call(call_id, answered_at=ago(MAX_SECONDS["practice"] + 31))

    async def run():
        with new_session() as db:
            from app.services.scheduler import tick
            await tick(db, utcnow())
            await asyncio.sleep(0.3)  # let the background task run

    asyncio.run(run())
    assert fakes.after == [call_id]


def test_tick_keeps_practice_inside_its_grace_period(client, make_family, fakes):
    call_id = answered_practice(client, make_family())
    set_call(call_id, answered_at=ago(MAX_SECONDS["practice"] + 20))
    tick_now()
    assert row(call_id)["status"] == "in_progress"


def test_tick_uses_the_welcome_limit_for_welcome_calls(client, make_family, fakes):
    sara, _ = ids(make_family())
    online(client, sara)
    call_id = client.post(f"/api/members/{sara}/welcome-call").json()["call_id"]
    client.post(f"/api/calls/{call_id}/answer")
    set_call(call_id, answered_at=ago(MAX_SECONDS["practice"] + 60))  # long for practice, fine for welcome
    tick_now()
    assert row(call_id)["status"] == "in_progress"
    set_call(call_id, answered_at=ago(MAX_SECONDS["welcome"] + 31))
    tick_now()
    assert row(call_id)["status"] == "ended"
    assert row(call_id)["ended_by"] == "timeout"


def test_tick_uses_the_family_line_limit(client, make_family, fakes):
    fam = make_family()
    sara, _ = ids(fam)
    ended_practice(client, fam)
    line = tap_family_line(client, sara).json()["call_id"]
    set_call(line, answered_at=ago(MAX_SECONDS["family_line"] + 20))
    tick_now()
    assert row(line)["status"] == "in_progress"
    set_call(line, answered_at=ago(MAX_SECONDS["family_line"] + 31))
    tick_now()
    assert row(line)["status"] == "ended"
    assert row(line)["ended_by"] == "timeout"


def test_tick_does_not_touch_finished_calls(client, make_family, fakes):
    fam = make_family()
    call_id = ended_practice(client, fam)
    set_call(call_id, ring_at=ago(500))
    tick_now()
    assert row(call_id)["status"] == "ended"
    assert fakes.after == [] or fakes.after == [call_id]  # only the earlier real end may have run


def test_run_forever_rings_due_calls_within_a_pass(client, make_family, fakes):
    from app.services.scheduler import run_forever

    call_id = scheduled_call(client, make_family())

    async def run():
        task = asyncio.create_task(run_forever())
        await asyncio.sleep(3.5)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(run())
    assert row(call_id)["status"] == "ringing"


def test_run_forever_survives_a_failing_pass(client, make_family, fakes, monkeypatch):
    from app.services import scheduler

    real_tick = scheduler.tick
    attempts: list[int] = []

    async def flaky_tick(db, now):
        attempts.append(1)
        if len(attempts) == 1:
            raise RuntimeError("one bad pass")
        await real_tick(db, now)

    monkeypatch.setattr(scheduler, "tick", flaky_tick)
    call_id = scheduled_call(client, make_family())

    async def run():
        task = asyncio.create_task(scheduler.run_forever())
        await asyncio.sleep(5.5)
        assert not task.done(), "the loop died after one failing pass"
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(run())
    assert len(attempts) >= 2
    assert row(call_id)["status"] == "ringing"


# ================================================================ event stream (real server)


class SseReader:
    """Reads a server-sent event stream on a thread."""

    def __init__(self, url: str, headers: dict[str, str] | None = None) -> None:
        self.events: list[dict[str, Any]] = []
        self.comments: list[str] = []
        self.response_headers: httpx.Headers | None = None
        self.status: int | None = None
        self._response: httpx.Response | None = None
        self._client = httpx.Client(timeout=httpx.Timeout(30.0, read=60.0))
        self._thread = threading.Thread(target=self._run, args=(url, headers or {}), daemon=True)
        self._thread.start()

    def _run(self, url: str, headers: dict[str, str]) -> None:
        try:
            with self._client.stream("GET", url, headers=headers) as response:
                self._response = response
                self.status = response.status_code
                self.response_headers = response.headers
                block: dict[str, str] = {}
                for line in response.iter_lines():
                    if line == "":
                        if "data" in block:
                            self.events.append(block)
                        block = {}
                    elif line.startswith(":"):
                        self.comments.append(line)
                    else:
                        field, _, value = line.partition(":")
                        block[field] = value.lstrip(" ")
        except Exception:
            pass

    def wait_for(self, count: int, seconds: float = 5.0) -> bool:
        return _wait_for(lambda: len(self.events) >= count, seconds)

    def wait_headers(self, seconds: float = 5.0) -> bool:
        return _wait_for(lambda: self.status is not None, seconds)

    def close(self) -> None:
        try:
            if self._response is not None:
                self._response.close()
            self._client.close()
        except Exception:
            pass
        self._thread.join(timeout=3)


@pytest.fixture
def server(client):
    """The real app on port 8765 (TestClient cannot read an endless stream)."""
    import uvicorn

    from app.main import app

    config = uvicorn.Config(app, host="127.0.0.1", port=8765, log_level="warning",
                            timeout_graceful_shutdown=2)
    uv = uvicorn.Server(config)
    thread = threading.Thread(target=uv.run, daemon=True)
    thread.start()
    assert _wait_for(lambda: uv.started, 10), "server did not start"
    readers: list[SseReader] = []

    def open_stream(call_id: str, headers: dict[str, str] | None = None) -> SseReader:
        reader = SseReader(f"http://127.0.0.1:8765/api/calls/{call_id}/events", headers)
        readers.append(reader)
        return reader

    yield open_stream
    for reader in readers:
        reader.close()
    uv.should_exit = True
    thread.join(timeout=10)


def test_stream_unknown_call_is_404(client):
    response = client.get("/api/calls/call_nope/events")
    assert response.status_code == 404
    assert error_code(response) == "not_found"


def test_stream_replays_stored_events_with_sse_fields_and_headers(client, make_family, fakes, server):
    call_id = answered_practice(client, make_family())
    client.post(f"/api/calls/{call_id}/events", json={"events": [
        {"type": "turn", "speaker": "agent", "text": "Mum? It's me."},
        {"type": "tactic", "key": "new_number"},
    ]})
    reader = server(call_id)
    assert reader.wait_for(4)
    assert reader.status == 200
    assert reader.response_headers["content-type"].startswith("text/event-stream")
    assert reader.response_headers["cache-control"] == "no-cache"
    assert reader.response_headers["x-accel-buffering"] == "no"
    got = reader.events[:4]
    assert [e["id"] for e in got] == ["1", "2", "3", "4"]
    assert [e["event"] for e in got] == ["call.status", "call.status", "turn", "tactic"]
    assert json.loads(got[0]["data"])["status"] == "ringing"
    assert json.loads(got[1]["data"])["status"] == "in_progress"
    assert json.loads(got[2]["data"])["text"] == "Mum? It's me."
    assert json.loads(got[3]["data"])["key"] == "new_number"
    assert json.loads(got[3]["data"])["label"] == TACTIC_LABELS["new_number"]


def test_stream_resumes_after_last_event_id(client, make_family, fakes, server):
    call_id = answered_practice(client, make_family())
    client.post(f"/api/calls/{call_id}/events", json={"events": [
        {"type": "turn", "speaker": "agent", "text": "one"},
        {"type": "turn", "speaker": "user", "text": "two"},
    ]})
    reader = server(call_id, {"Last-Event-ID": "2"})
    assert reader.wait_for(2)
    time.sleep(0.3)
    assert [e["id"] for e in reader.events] == ["3", "4"]


def test_stream_continues_live_after_the_replay(client, make_family, fakes, server):
    call_id = answered_practice(client, make_family())
    reader = server(call_id)
    assert reader.wait_for(2)
    client.post(f"/api/calls/{call_id}/events", json={"events": [{"type": "tactic", "key": "urgency"}]})
    client.post(f"/api/calls/{call_id}/end", json={"ended_by": "agent"})
    assert reader.wait_for(4)
    assert [e["id"] for e in reader.events[:4]] == ["1", "2", "3", "4"]
    assert reader.events[2]["event"] == "tactic"
    assert reader.events[3]["event"] == "call.status"
    assert json.loads(reader.events[3]["data"])["status"] == "ended"


def test_stream_delivers_callback_connected(client, make_family, fakes, server):
    fam = make_family()
    sara, _ = ids(fam)
    practice = ended_practice(client, fam, ended_ago=20)
    reader = server(practice)
    assert reader.wait_for(3)
    tap_family_line(client, sara)
    assert _wait_for(lambda: any(e["event"] == "callback.connected" for e in reader.events), 5)


def test_stream_subscriber_is_removed_on_disconnect(client, make_family, fakes, server):
    call_id = answered_practice(client, make_family())
    reader = server(call_id)
    assert reader.wait_for(2)
    assert _wait_for(lambda: events_mod.subscriber_count(call_id) == 1, 3)
    reader.close()
    assert _wait_for(lambda: events_mod.subscriber_count(call_id) == 0, 8)


def test_stream_sends_a_keep_alive_comment_every_15_seconds(client, make_family, fakes, server):
    call_id = answered_practice(client, make_family())
    reader = server(call_id)
    assert reader.wait_for(2)
    assert reader.comments == []
    assert _wait_for(lambda: len(reader.comments) >= 1, 19), "no keep-alive comment within 19 seconds"
    assert reader.comments[0].startswith(":")

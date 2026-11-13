"""Track B tests: starting, answering, reporting, ending and reading calls.
OWNER: track B. Tracks A and C are faked with monkeypatch."""

import json
from datetime import timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app import events, schemas
from app.db import new_session, now_iso, parse_time, to_iso, utcnow
from app.ids import new_call_id
from app.models import Call, Consent, Member, Result
from app.routers import calls
from app.services import briefs, pipeline, sessions


@pytest.fixture
def fakes(monkeypatch) -> SimpleNamespace:
    state = SimpleNamespace(briefs=[], sessions=[], after=[], session_error=None, brief_hook=None)

    async def fake_build_brief(db, target, voice_member, scenario_key, difficulty):
        state.briefs.append((target.id, voice_member.id if voice_member else None, scenario_key, difficulty))
        if state.brief_hook:
            state.brief_hook()
        return briefs.BuiltBrief(variables={"target_name": target.name, "difficulty": difficulty},
                                 caller_label="Unknown number", caller_number="+00 600 555 0142")

    async def fake_build_session(db, call):
        state.sessions.append(call.id)
        if state.session_error:
            raise state.session_error
        call.conversation_id = "conv_test"
        db.commit()
        return schemas.Session(kind=call.kind, conversation_token="tok", conversation_id="conv_test",
                               overrides={}, dynamic_variables={}, max_seconds=schemas.MAX_SECONDS[call.kind])

    def fake_after_call(call_id):
        state.after.append(call_id)

        async def nothing() -> None:
            return None

        return nothing()

    monkeypatch.setattr(briefs, "build_brief", fake_build_brief)
    monkeypatch.setattr(sessions, "build_session", fake_build_session)
    monkeypatch.setattr(pipeline, "after_call", fake_after_call)
    return state


# ---------------------------------------------------------------- helpers


def members(family) -> tuple[str, str]:
    return family["members"][0]["id"], family["members"][1]["id"]


def update_member(member_id: str, **fields) -> None:
    with new_session() as db:
        member = db.get(Member, member_id)
        for name, value in fields.items():
            setattr(member, name, value)
        db.commit()


def give_voice(member_id: str) -> None:
    update_member(member_id, consent_clone_at=now_iso(), voice_id="voice_test", voice_status="ready")


def load_call(call_id: str) -> Call:
    with new_session() as db:
        return db.get(Call, call_id)


def statuses(call_id: str) -> list[str]:
    return [e["data"]["status"] for e in events.list_events(call_id) if e["type"] == "call.status"]


def practice(client, family, voice: bool = True, **extra) -> str:
    sara, jon = members(family)
    if voice:
        give_voice(jon)
    client.get(f"/api/members/{sara}/phone-state")
    body = {"target_member_id": sara, "voice_member_id": jon if voice else None, **extra}
    response = client.post("/api/practice-calls", json=body)
    assert response.status_code == 201, response.text
    return response.json()["call_id"]


def answered(client, family) -> str:
    call_id = practice(client, family)
    assert client.post(f"/api/calls/{call_id}/answer").status_code == 200
    return call_id


def post(client, sara, voice=None):
    return client.post("/api/practice-calls", json={"target_member_id": sara, "voice_member_id": voice})


# ---------------------------------------------------------------- starting a practice


def test_practice_rings_and_stores_the_brief(client, make_family, fakes):
    family = make_family()
    sara, jon = members(family)
    call_id = practice(client, family, scenario="relative_new_number", difficulty=2)
    call = load_call(call_id)
    assert call.status == "ringing" and call.ring_at is not None
    assert call.voice_member_id == jon and call.difficulty == 2
    assert json.loads(call.brief_json) == {"target_name": "Sara", "difficulty": 2}
    assert (call.caller_label, call.caller_number) == ("Unknown number", "+00 600 555 0142")
    assert statuses(call_id) == ["ringing"]
    assert fakes.briefs == [(sara, jon, "relative_new_number", 2)]


def test_practice_with_delay_is_scheduled_and_silent(client, make_family, fakes):
    family = make_family()
    sara, _ = members(family)
    call_id = practice(client, family, delay_seconds=120)
    call = load_call(call_id)
    assert call.status == "scheduled"
    assert abs((parse_time(call.scheduled_for) - utcnow()).total_seconds() - 120) < 5
    assert statuses(call_id) == []
    assert client.get(f"/api/members/{sara}/phone-state").json()["incoming_call"] is None


def test_unknown_members_are_404(client, make_family, fakes):
    sara, _ = members(make_family())
    _, other_jon = members(make_family())
    give_voice(other_jon)
    client.get(f"/api/members/{sara}/phone-state")
    for response in (post(client, "mem_nope"), post(client, sara, "mem_nope"), post(client, sara, other_jon)):
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"


@pytest.mark.parametrize("change", [{"consent_practice_at": None}, {"opted_out_at": "2026-11-13T10:00:00+00:00"}])
def test_target_without_consent_is_consent_missing(client, make_family, fakes, change):
    sara, _ = members(make_family())
    update_member(sara, **change)
    client.get(f"/api/members/{sara}/phone-state")
    response = post(client, sara)
    assert (response.status_code, response.json()["error"]["code"]) == (409, "consent_missing")
    assert fakes.briefs == []


@pytest.mark.parametrize("change", [
    {"voice_status": "none"}, {"consent_clone_at": None}, {"voice_id": None},
    {"voice_status": "deleted"}, {"opted_out_at": "2026-11-13T10:00:00+00:00"},
])
def test_voice_not_ready(client, make_family, fakes, change):
    sara, jon = members(make_family())
    give_voice(jon)
    update_member(jon, **change)
    client.get(f"/api/members/{sara}/phone-state")
    response = post(client, sara, jon)
    assert (response.status_code, response.json()["error"]["code"]) == (409, "voice_not_ready")


def test_busy_while_a_call_rings_or_runs(client, make_family, fakes):
    family = make_family()
    sara, _ = members(family)
    call_id = practice(client, family, voice=False)
    assert post(client, sara).json()["error"]["code"] == "busy"
    client.post(f"/api/calls/{call_id}/answer")
    assert post(client, sara).json()["error"]["code"] == "busy"
    client.post(f"/api/calls/{call_id}/end", json={"ended_by": "user"})
    client.get(f"/api/members/{sara}/phone-state")
    assert post(client, sara).status_code == 201


def test_phone_offline(client, make_family, fakes):
    sara, _ = members(make_family())
    assert post(client, sara).json()["error"]["code"] == "phone_offline"
    update_member(sara, last_seen_at=to_iso(utcnow() - timedelta(seconds=11)))
    assert post(client, sara).json()["error"]["code"] == "phone_offline"
    update_member(sara, last_seen_at=to_iso(utcnow() - timedelta(seconds=8)))
    assert post(client, sara).status_code == 201


def test_gate_order(client, make_family, fakes):
    family = make_family(consent=False)
    sara, jon = members(family)
    # no consent, no voice, offline: consent comes first
    assert post(client, sara, jon).json()["error"]["code"] == "consent_missing"
    update_member(sara, consent_practice_at=now_iso())
    # no voice and offline: the voice comes before the phone
    assert post(client, sara, jon).json()["error"]["code"] == "voice_not_ready"


def test_busy_is_checked_again_after_the_brief(client, make_family, fakes):
    family = make_family()
    sara, _ = members(family)
    client.get(f"/api/members/{sara}/phone-state")

    def another_call_starts() -> None:
        with new_session() as db:
            db.add(Call(id=new_call_id(), family_id=family["family_id"], kind="welcome", target_member_id=sara,
                        status="ringing", difficulty=1, ring_at=now_iso(), created_at=now_iso()))
            db.commit()

    fakes.brief_hook = another_call_starts
    response = post(client, sara)
    assert response.json()["error"]["code"] == "busy"
    with new_session() as db:
        assert db.scalars(select(Call).where(Call.kind == "practice")).all() == []


async def test_create_practice_can_skip_the_phone_check(client, make_family, fakes):
    sara, _ = members(make_family())
    with new_session() as db:
        with pytest.raises(schemas.ApiError) as caught:
            await calls.create_practice(db, sara, None, "police", 1)
        assert caught.value.code == "phone_offline"
        call = await calls.create_practice(db, sara, None, "police", 5, check_phone_online=False)
    assert call.status == "ringing" and call.difficulty == 3


# ---------------------------------------------------------------- welcome call


def test_welcome_call_rings_without_consent(client, make_family, fakes):
    sara, _ = members(make_family(consent=False))
    assert client.post(f"/api/members/{sara}/welcome-call").json()["error"]["code"] == "phone_offline"
    client.get(f"/api/members/{sara}/phone-state")
    response = client.post(f"/api/members/{sara}/welcome-call")
    assert response.status_code == 201
    call_id = response.json()["call_id"]
    assert load_call(call_id).kind == "welcome"
    incoming = client.get(f"/api/members/{sara}/phone-state").json()["incoming_call"]
    assert incoming["call_id"] == call_id and incoming["kind"] == "welcome"
    assert client.post(f"/api/members/{sara}/welcome-call").json()["error"]["code"] == "busy"
    assert client.post("/api/members/mem_nope/welcome-call").status_code == 404


# ---------------------------------------------------------------- answer and decline


def test_answer_starts_the_call_and_returns_the_session(client, make_family, fakes):
    call_id = practice(client, make_family())
    response = client.post(f"/api/calls/{call_id}/answer")
    assert response.status_code == 200
    assert response.json()["conversation_token"] == "tok"
    call = load_call(call_id)
    assert call.status == "in_progress" and call.answered_at and call.conversation_id == "conv_test"
    assert statuses(call_id) == ["ringing", "in_progress"]
    again = client.post(f"/api/calls/{call_id}/answer")
    assert (again.status_code, again.json()["error"]["code"]) == (409, "not_ringing")
    assert client.post("/api/calls/call_nope/answer").status_code == 404


def test_answer_marks_the_call_failed_when_the_session_fails(client, make_family, fakes):
    fakes.session_error = RuntimeError("no token")
    call_id = practice(client, make_family())
    response = client.post(f"/api/calls/{call_id}/answer")
    assert (response.status_code, response.json()["error"]["code"]) == (502, "session_failed")
    assert load_call(call_id).status == "failed"
    assert statuses(call_id) == ["ringing", "in_progress", "failed"]


def test_answer_keeps_the_status_of_an_api_error_from_the_session(client, make_family, fakes):
    fakes.session_error = schemas.ApiError(503, "agent_not_configured", "No agent id.")
    call_id = practice(client, make_family())
    response = client.post(f"/api/calls/{call_id}/answer")
    assert (response.status_code, response.json()["error"]["code"]) == (503, "agent_not_configured")
    assert load_call(call_id).status == "failed"


def test_answer_after_opt_out_fails_the_call(client, make_family, fakes):
    family = make_family()
    sara, _ = members(family)
    call_id = practice(client, family)
    update_member(sara, opted_out_at=now_iso())
    response = client.post(f"/api/calls/{call_id}/answer")
    assert (response.status_code, response.json()["error"]["code"]) == (409, "consent_missing")
    assert load_call(call_id).status == "failed"
    assert statuses(call_id) == ["ringing", "failed"]
    assert fakes.sessions == []


def test_answer_after_the_voice_was_deleted_fails_the_call(client, make_family, fakes):
    family = make_family()
    _, jon = members(family)
    call_id = practice(client, family)
    update_member(jon, voice_id=None, voice_status="none")
    response = client.post(f"/api/calls/{call_id}/answer")
    assert (response.status_code, response.json()["error"]["code"]) == (409, "voice_not_ready")
    assert load_call(call_id).status == "failed"
    assert fakes.sessions == []


def test_decline(client, make_family, fakes):
    call_id = practice(client, make_family())
    assert client.post(f"/api/calls/{call_id}/decline").json() == {"ok": True}
    assert load_call(call_id).status == "declined"
    assert statuses(call_id) == ["ringing", "declined"]
    assert client.post(f"/api/calls/{call_id}/decline").status_code == 409
    assert client.post(f"/api/calls/{call_id}/answer").status_code == 409


# ---------------------------------------------------------------- events


def test_events_are_stored_with_labels_and_seconds_to_challenge(client, make_family, fakes):
    call_id = answered(client, make_family())
    response = client.post(f"/api/calls/{call_id}/events", json={"events": [
        {"type": "turn", "speaker": "agent", "text": "Mum? It's me."},
        {"type": "tactic", "key": "new_number"},
        {"type": "outcome", "outcome": "asked_safe_word"},
        {"type": "outcome", "outcome": "agreed"},
        {"type": "revealed"},
    ]})
    assert response.json() == {"ok": True}
    stored = events.list_events(call_id)[2:]
    assert [e["type"] for e in stored] == ["turn", "tactic", "outcome", "outcome", "revealed"]
    assert stored[1]["data"] == {"key": "new_number", "label": "New number"}
    assert stored[2]["data"]["seconds_to_challenge"] >= 0
    assert "seconds_to_challenge" not in stored[3]["data"]


def test_bad_tactic_or_outcome_is_422_and_nothing_is_stored(client, make_family, fakes):
    call_id = answered(client, make_family())
    for bad in ({"type": "tactic", "key": "flattery"}, {"type": "outcome", "outcome": "paid"}):
        response = client.post(f"/api/calls/{call_id}/events",
                               json={"events": [{"type": "revealed"}, bad]})
        assert response.status_code == 422
    assert len(events.list_events(call_id)) == 2


def test_events_need_an_answered_call(client, make_family, fakes):
    call_id = practice(client, make_family())
    response = client.post(f"/api/calls/{call_id}/events", json={"events": [{"type": "revealed"}]})
    assert (response.status_code, response.json()["error"]["code"]) == (409, "not_answered")
    assert client.post("/api/calls/call_nope/events", json={"events": [{"type": "revealed"}]}).status_code == 404


def test_events_after_the_end_are_kept_with_a_capped_challenge_time(client, make_family, fakes):
    call_id = answered(client, make_family())
    client.post(f"/api/calls/{call_id}/end", json={"ended_by": "agent"})
    with new_session() as db:
        call = db.get(Call, call_id)
        call.answered_at = to_iso(utcnow() - timedelta(seconds=60))
        call.ended_at = to_iso(utcnow() - timedelta(seconds=50))
        db.commit()
    response = client.post(f"/api/calls/{call_id}/events",
                           json={"events": [{"type": "outcome", "outcome": "hung_up"}]})
    assert response.status_code == 200
    outcome = [e for e in events.list_events(call_id) if e["type"] == "outcome"][0]
    assert abs(outcome["data"]["seconds_to_challenge"] - 10) < 1


def test_events_for_a_failed_call_are_409(client, make_family, fakes):
    call_id = answered(client, make_family())
    with new_session() as db:
        db.get(Call, call_id).status = "failed"
        db.commit()
    before = len(events.list_events(call_id))
    response = client.post(f"/api/calls/{call_id}/events", json={"events": [{"type": "revealed"}]})
    assert (response.status_code, response.json()["error"]["code"]) == (409, "call_over")
    assert len(events.list_events(call_id)) == before


def test_a_late_revealed_on_a_scored_call_is_kept(client, make_family, fakes):
    call_id = answered(client, make_family())
    client.post(f"/api/calls/{call_id}/end", json={"ended_by": "agent"})
    with new_session() as db:
        db.get(Call, call_id).status = "scored"
        db.commit()
    response = client.post(f"/api/calls/{call_id}/events", json={"events": [{"type": "revealed"}]})
    assert response.status_code == 200
    assert events.list_events(call_id)[-1]["type"] == "revealed"
    assert fakes.after == [call_id], "a late event never starts the after-call work again"


def test_spoken_consent_on_the_welcome_call(client, make_family, fakes):
    sara, _ = members(make_family(consent=False))
    client.get(f"/api/members/{sara}/phone-state")
    call_id = client.post(f"/api/members/{sara}/welcome-call").json()["call_id"]
    client.post(f"/api/calls/{call_id}/answer")
    client.post(f"/api/calls/{call_id}/events", json={"events": [{"type": "consent", "given": False}]})
    with new_session() as db:
        assert db.get(Member, sara).consent_practice_at is None
    for _ in range(2):  # a repeated yes writes one row
        client.post(f"/api/calls/{call_id}/events", json={"events": [{"type": "consent", "given": True}]})
    with new_session() as db:
        assert db.get(Member, sara).consent_practice_at is not None
        rows = db.scalars(select(Consent).where(Consent.member_id == sara)).all()
        assert [(r.kind, r.source, r.call_id) for r in rows] == [("practice", "welcome_call", call_id)]


# ---------------------------------------------------------------- end


def test_end_finishes_the_call_and_starts_the_pipeline_once(client, make_family, fakes):
    call_id = answered(client, make_family())
    assert client.post(f"/api/calls/{call_id}/end", json={"ended_by": "agent"}).json() == {"ok": True}
    call = load_call(call_id)
    assert (call.status, call.ended_by) == ("ended", "agent") and call.ended_at
    assert client.post(f"/api/calls/{call_id}/end", json={"ended_by": "user"}).status_code == 200
    assert load_call(call_id).ended_by == "agent"
    assert statuses(call_id) == ["ringing", "in_progress", "ended"]
    assert fakes.after == [call_id]


def test_end_of_a_ringing_call_is_409(client, make_family, fakes):
    call_id = practice(client, make_family())
    response = client.post(f"/api/calls/{call_id}/end", json={"ended_by": "user"})
    assert (response.status_code, response.json()["error"]["code"]) == (409, "not_answered")
    assert load_call(call_id).status == "ringing"


def test_end_survives_the_pipeline_stub(client, make_family, monkeypatch, fakes):
    async def stub(call_id):
        raise NotImplementedError

    monkeypatch.setattr(pipeline, "after_call", stub)
    call_id = answered(client, make_family())
    assert client.post(f"/api/calls/{call_id}/end", json={"ended_by": "agent"}).status_code == 200
    assert load_call(call_id).status == "ended"


# ---------------------------------------------------------------- reading a call


def test_get_call_builds_turns_tactics_and_result(client, make_family, fakes):
    family = make_family()
    sara, jon = members(family)
    call_id = answered(client, family)
    client.post(f"/api/calls/{call_id}/events", json={"events": [
        {"type": "turn", "speaker": "agent", "text": "Mum? It's me."},
        {"type": "tactic", "key": "urgency"},
        {"type": "turn", "speaker": "user", "text": "What's our word?"},
    ]})
    body = client.get(f"/api/calls/{call_id}").json()
    assert body["target"] == {"id": sara, "name": "Sara"}
    assert body["voice_of"] == {"id": jon, "name": "Jon"}
    assert [(t["speaker"], t["tactic"]) for t in body["turns"]] == [("agent", "urgency"), ("user", None)]
    assert [(t["key"], t["label"]) for t in body["tactics"]] == [("urgency", "Urgency")]
    assert body["result"] is None

    client.post(f"/api/calls/{call_id}/end", json={"ended_by": "agent"})
    with new_session() as db:
        db.add(Result(call_id=call_id, outcome="asked_safe_word", seconds_to_challenge=8.0,
                      tactics_used_json='["urgency"]', tactics_worked_json="[]", lesson="Good.",
                      created_at=now_iso()))
        db.commit()
    assert client.get(f"/api/calls/{call_id}").json()["result"] is None  # not scored yet
    with new_session() as db:
        db.get(Call, call_id).status = "scored"
        db.commit()
    result = client.get(f"/api/calls/{call_id}").json()["result"]
    assert result["outcome"] == "asked_safe_word" and result["tactics_used"] == ["urgency"]
    assert client.get("/api/calls/call_nope").status_code == 404

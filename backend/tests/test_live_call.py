"""Live calls (services/live_call.py, routers/live.py): a person calls a family
member through Callback and the Shield listens. No network: ElevenLabs is
faked; risk results are stored by the test, as test_shield.py does."""

from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app import events
from app.db import new_session
from app.models import Call, CallShield, LiveCall, Message, ProtectionSettings
from app.services import shield
from app.schemas import RISK_SIGNAL_LABELS


def ids(family) -> list[str]:
    return [member["id"] for member in family["members"]]


def phone_state(client, member_id: str) -> dict:
    response = client.get(f"/api/members/{member_id}/phone-state")
    assert response.status_code == 200, response.text
    return response.json()


def start(client, family, member_id: str):
    return client.post(f"/api/families/{family['family_id']}/live-call", json={"member_id": member_id})


def red() -> dict:
    signals = ["new_number", "money_request"]
    return {"level": "red", "signals": signals, "labels": [RISK_SIGNAL_LABELS[key] for key in signals],
            "reason": "Asks for money today", "turn_index": 0, "source": "risk.v1"}


def messages_of(member_id: str) -> list[Message]:
    with new_session() as db:
        return list(db.scalars(select(Message).where(Message.member_id == member_id).order_by(Message.id)))


@pytest.fixture
def family3(client, make_family) -> SimpleNamespace:
    family = make_family(members=3)
    sara, jon, ana = ids(family)
    return SimpleNamespace(family=family, sara=sara, jon=jon, ana=ana)


def test_a_live_call_rings_as_live_and_is_a_shield_call(client, family3):
    phone_state(client, family3.sara)  # her phone page is open
    response = start(client, family3.family, family3.sara)
    assert response.status_code == 201, response.text
    call_id = response.json()["call_id"]
    assert response.json()["member"]["id"] == family3.sara

    incoming = phone_state(client, family3.sara)["incoming_call"]
    assert incoming["call_id"] == call_id and incoming["live"] is True and incoming["kind"] == "practice"
    with new_session() as db:
        call = db.get(Call, call_id)
        assert (call.status, call.voice_member_id) == ("ringing", None)
        assert db.get(CallShield, call_id) is not None and db.get(LiveCall, call_id) is not None


def test_signals_go_to_the_other_side_only(client, family3):
    phone_state(client, family3.sara)
    call_id = start(client, family3.family, family3.sara).json()["call_id"]
    sent = client.post(f"/api/calls/{call_id}/live/signal", json={"side": "caller", "kind": "offer",
                                                                  "data": {"type": "offer", "sdp": "v=0"}})
    assert sent.status_code == 200, sent.text
    for_callee = client.get(f"/api/calls/{call_id}/live/signal", params={"side": "callee", "after": 0}).json()
    assert [(m["n"], m["kind"]) for m in for_callee["messages"]] == [(1, "offer")]
    assert for_callee["status"] == "ringing"
    # The caller does not get its own offer back.
    assert client.get(f"/api/calls/{call_id}/live/signal", params={"side": "caller"}).json()["messages"] == []
    client.post(f"/api/calls/{call_id}/live/signal", json={"side": "callee", "kind": "answer", "data": {"sdp": "x"}})
    for_caller = client.get(f"/api/calls/{call_id}/live/signal", params={"side": "caller", "after": 0}).json()
    assert [(m["n"], m["kind"]) for m in for_caller["messages"]] == [(2, "answer")]
    # After what it has seen, nothing new.
    assert client.get(f"/api/calls/{call_id}/live/signal", params={"side": "caller", "after": 2}).json()["messages"] == []


def test_answer_turns_red_and_alert_end(client, family3):
    phone_state(client, family3.sara)
    call_id = start(client, family3.family, family3.sara).json()["call_id"]
    token = client.post(f"/api/calls/{call_id}/live/scribe-token")
    assert token.status_code == 200 and token.json()["token"].startswith("fake-scribe-")

    assert client.post(f"/api/calls/{call_id}/live/answer").status_code == 200
    assert client.post(f"/api/calls/{call_id}/live/answer").json()["error"]["code"] == "not_ringing"
    assert phone_state(client, family3.sara)["incoming_call"] is None

    # The caller's browser posts what the caller said, as caller turns.
    turn = client.post(f"/api/calls/{call_id}/events", json={"events": [
        {"type": "turn", "speaker": "agent", "text": "Hi, it's your bank. Move your savings to a safe account today."}]})
    assert turn.status_code == 200, turn.text
    # What the live risk check does when it judges the call red:
    stored = events.publish(call_id, "risk", red())["data"]
    shield.on_risk(call_id, stored)
    assert phone_state(client, family3.sara)["shield"]["warn"] is True
    assert [m.kind for m in messages_of(family3.jon)] == ["alert"]
    assert [m.kind for m in messages_of(family3.ana)] == ["alert"]

    assert client.post(f"/api/calls/{call_id}/end", json={"ended_by": "user"}).status_code == 200
    after = client.get(f"/api/calls/{call_id}/live/signal", params={"side": "caller"}).json()
    assert after["status"] == "ended"
    refused = client.post(f"/api/calls/{call_id}/live/signal", json={"side": "caller", "kind": "bye"})
    assert refused.json()["error"]["code"] == "call_over"


def test_live_call_gates(client, family3, make_family):
    # The phone page must be open, or it cannot ring.
    assert start(client, family3.family, family3.sara).json()["error"]["code"] == "phone_offline"
    # Not a member of this family.
    other = ids(make_family(members=2))[0]
    assert start(client, family3.family, other).json()["error"]["code"] == "not_found"
    # The Shield switched off.
    phone_state(client, family3.sara)
    with new_session() as db:
        db.add(ProtectionSettings(family_id=family3.family["family_id"], shield_enabled=False))
        db.commit()
    assert start(client, family3.family, family3.sara).json()["error"]["code"] == "shield_off"


def test_live_endpoints_refuse_other_calls(client, family3):
    phone_state(client, family3.sara)
    response = client.post(f"/api/families/{family3.family['family_id']}/shield-call",
                           json={"member_id": family3.sara})
    shield_call = response.json()["call_id"]
    assert client.post(f"/api/calls/{shield_call}/live/answer").json()["error"]["code"] == "not_found"
    assert client.get(f"/api/calls/{shield_call}/live/signal", params={"side": "caller"}).status_code == 404
    assert phone_state(client, family3.sara)["incoming_call"]["live"] is False

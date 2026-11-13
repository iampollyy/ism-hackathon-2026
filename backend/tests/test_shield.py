"""Track 3: shield calls and the Shield (services/shield.py, the shield-call
and alert endpoints in routers/protection.py, the hooks in phone-state,
sessions, live_risk and GET /api/calls/{id}). No network: ElevenLabs is
faked, the director has no model key (template briefs), and risk results
are stored by the test (events.publish) or come from a faked risk job."""

import base64
import json
import time
from types import SimpleNamespace

import pytest
from sqlalchemy import select, text

from app import events
from app.agents import risk
from app.config import get_settings
from app.db import new_session, now_iso
from app.ids import new_call_id
from app.models import Call, CallShield, Member, Message, ProtectionSettings
from app.services import live_risk, push, shield

SHIELD_REVEAL = ("Sara, this was a simulated scam call to show how Callback Shield protects you. "
                 "The voice you heard was artificial.")


# ---------------------------------------------------------------- helpers


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def ids(family) -> list[str]:
    return [member["id"] for member in family["members"]]


def update_member(member_id: str, **fields) -> None:
    with new_session() as db:
        member = db.get(Member, member_id)
        for name, value in fields.items():
            setattr(member, name, value)
        db.commit()


def give_voice(member_id: str) -> None:
    update_member(member_id, consent_clone_at=now_iso(), voice_id=f"voice_{member_id}", voice_status="ready")


def phone_state(client, member_id: str) -> dict:
    response = client.get(f"/api/members/{member_id}/phone-state")
    assert response.status_code == 200, response.text
    return response.json()


def start_shield_call(client, family, member_id: str, **extra) -> dict:
    phone_state(client, member_id)  # the phone page is open
    response = client.post(f"/api/families/{family['family_id']}/shield-call", json={"member_id": member_id, **extra})
    assert response.status_code == 201, response.text
    return response.json()


def answer(client, call_id: str) -> dict:
    response = client.post(f"/api/calls/{call_id}/answer")
    assert response.status_code == 200, response.text
    return response.json()


def start_practice(client, target: str, voice: str | None = None, scenario: str = "relative_new_number") -> str:
    phone_state(client, target)
    response = client.post("/api/practice-calls", json={"target_member_id": target, "voice_member_id": voice,
                                                         "scenario": scenario})
    assert response.status_code == 201, response.text
    return response.json()["call_id"]


def risk_data(level: str, signals: list[str], reason: str = "Asks for money today") -> dict:
    from app.schemas import RISK_SIGNAL_LABELS

    return {"level": level, "signals": signals, "labels": [RISK_SIGNAL_LABELS[key] for key in signals],
            "reason": reason, "turn_index": 0, "source": "risk.v1"}


def store_risk(call_id: str, data: dict) -> dict:
    """What live_risk does: store the risk event, then the Shield's hook."""
    stored = events.publish(call_id, "risk", data)["data"]
    shield.on_risk(call_id, stored)
    return stored


def messages_of(member_id: str) -> list[Message]:
    with new_session() as db:
        return list(db.scalars(select(Message).where(Message.member_id == member_id).order_by(Message.id)))


def event_types(call_id: str) -> list[str]:
    return [event["type"] for event in events.list_events(call_id)]


def load_call(call_id: str) -> Call:
    with new_session() as db:
        return db.get(Call, call_id)


@pytest.fixture
def kovacs(client, make_family) -> SimpleNamespace:
    """Sara (mother), Jon (son, organiser, ready voice), Ana (daughter)."""
    family = make_family(members=3)
    sara, jon, ana = ids(family)
    give_voice(jon)
    return SimpleNamespace(family=family, sara=sara, jon=jon, ana=ana)


@pytest.fixture
def live_shield_call(client, kovacs) -> str:
    """A shield call for Sara in Jon's voice, answered."""
    call_id = start_shield_call(client, kovacs.family, kovacs.sara)["call_id"]
    answer(client, call_id)
    return call_id


# ---------------------------------------------------------------- starting a shield call


def test_shield_call_rings_now_in_another_members_voice(client, kovacs):
    body = start_shield_call(client, kovacs.family, kovacs.sara)
    assert body["member"] == {"id": kovacs.sara, "name": "Sara"}
    assert body["scenario"] == "relative_new_number"
    call = load_call(body["call_id"])
    assert (call.kind, call.status, call.voice_member_id, call.difficulty) == ("practice", "ringing", kovacs.jon, 2)
    assert json.loads(call.brief_json)["reveal_line"] == SHIELD_REVEAL
    with new_session() as db:
        assert db.get(CallShield, call.id).alerted_at is None
    assert phone_state(client, kovacs.sara)["incoming_call"]["call_id"] == call.id
    assert phone_state(client, kovacs.sara)["shield"] is None  # ringing, not in progress yet


def test_shield_call_without_a_ready_voice_uses_the_bank_scenario(client, make_family):
    family = make_family()
    sara, _ = ids(family)
    body = start_shield_call(client, family, sara)
    assert body["scenario"] == "bank_security"
    assert load_call(body["call_id"]).voice_member_id is None


def test_shield_call_takes_the_given_scenario_and_voice(client, kovacs):
    give_voice(kovacs.ana)
    body = start_shield_call(client, kovacs.family, kovacs.sara, voice_member_id=kovacs.ana)
    call = load_call(body["call_id"])
    assert (call.scenario, call.voice_member_id) == ("relative_new_number", kovacs.ana)


def test_shield_call_library_scenario_has_no_voice(client, kovacs):
    body = start_shield_call(client, kovacs.family, kovacs.sara, scenario="police")
    call = load_call(body["call_id"])
    assert (call.scenario, call.voice_member_id) == ("police", None)


def test_shield_call_keeps_the_practice_checks(client, kovacs):
    url = f"/api/families/{kovacs.family['family_id']}/shield-call"
    response = client.post(url, json={"member_id": kovacs.sara})  # the phone page was never opened
    assert (response.status_code, response.json()["error"]["code"]) == (409, "phone_offline")
    update_member(kovacs.ana, consent_practice_at=None)
    phone_state(client, kovacs.ana)
    response = client.post(url, json={"member_id": kovacs.ana})
    assert (response.status_code, response.json()["error"]["code"]) == (409, "consent_missing")
    assert client.post(url, json={"member_id": "mem_nobody"}).status_code == 404
    assert client.post("/api/families/fam_nobody/shield-call", json={"member_id": kovacs.sara}).status_code == 404
    with new_session() as db:
        assert list(db.scalars(select(CallShield))) == []


def test_shield_call_is_refused_when_the_shield_is_off(client, kovacs):
    client.put(f"/api/families/{kovacs.family['family_id']}/protection", json={"shield_enabled": False})
    phone_state(client, kovacs.sara)
    response = client.post(f"/api/families/{kovacs.family['family_id']}/shield-call", json={"member_id": kovacs.sara})
    assert (response.status_code, response.json()["error"]["code"]) == (409, "shield_off")


# ---------------------------------------------------------------- the reveal


def test_shield_call_reveals_itself_as_a_simulated_scam_call(client, kovacs):
    call_id = start_shield_call(client, kovacs.family, kovacs.sara)["call_id"]
    session = answer(client, call_id)
    assert session["kind"] == "practice"
    assert session["reveal"] == {"voice_of": "Jon", "kind": "shield"}
    assert session["dynamic_variables"]["reveal_line"] == SHIELD_REVEAL


def test_a_training_drill_keeps_the_practice_reveal(client, kovacs):
    session = answer(client, start_practice(client, kovacs.sara, kovacs.jon))
    assert session["reveal"] == {"voice_of": "Jon", "kind": "practice"}
    assert session["dynamic_variables"]["reveal_line"] == (
        "Sara, this was a Callback practice call. The voice you heard was artificial, made with Jon's permission.")


# ---------------------------------------------------------------- the live warning on the phone


def test_phone_state_warns_only_from_the_stored_risk_events(client, kovacs, live_shield_call):
    state = phone_state(client, kovacs.sara)["shield"]
    assert state == {"call_id": live_shield_call, "level": "green", "reason": "Nothing worrying yet", "signals": [],
                     "labels": [], "warn": False, "message": None,
                     "call_back": {"member_id": kovacs.jon, "name": "Jon", "phone_number": None}}

    events.publish(live_shield_call, "risk", risk_data("yellow", ["new_number", "urgency"], "Caller rushes you"))
    state = phone_state(client, kovacs.sara)["shield"]
    assert (state["level"], state["warn"], state["message"], state["labels"]) == (
        "yellow", False, None, ["New number", "Urgency"])

    events.publish(live_shield_call, "risk", risk_data("red", ["new_number", "urgency", "money_request"]))
    state = phone_state(client, kovacs.sara)["shield"]
    assert (state["level"], state["warn"], state["reason"]) == ("red", True, "Asks for money today")
    assert state["message"] == "This sounds like a scam. Hang up and call Jon on their usual number."


def test_yellow_with_a_scam_signal_warns(client, kovacs, live_shield_call):
    events.publish(live_shield_call, "risk", risk_data("yellow", ["asks_for_code"]))
    assert phone_state(client, kovacs.sara)["shield"]["warn"] is True
    assert shield.should_warn(risk_data("yellow", ["refuses_callback"])) is True
    assert shield.should_warn(risk_data("yellow", ["urgency", "authority"])) is False
    assert shield.should_warn({"level": "green", "signals": []}) is False
    assert shield.should_warn(None) is False


def test_a_training_drill_never_shows_the_shield(client, kovacs):
    call_id = start_practice(client, kovacs.sara, kovacs.jon)
    answer(client, call_id)
    store_risk(call_id, risk_data("red", ["money_request"]))
    assert phone_state(client, kovacs.sara)["shield"] is None
    assert messages_of(kovacs.jon) == [] and messages_of(kovacs.ana) == []
    assert "shield.alert" not in event_types(call_id)
    assert client.get(f"/api/calls/{call_id}").json()["shield"] is None


def test_the_shield_goes_once_the_call_ends(client, kovacs, live_shield_call):
    assert phone_state(client, kovacs.sara)["shield"] is not None
    assert phone_state(client, kovacs.jon)["shield"] is None  # only the person on the call
    client.post(f"/api/calls/{live_shield_call}/end", json={"ended_by": "user"})
    assert phone_state(client, kovacs.sara)["shield"] is None


def test_a_library_voice_call_backs_to_the_organiser(client, kovacs):
    call_id = start_shield_call(client, kovacs.family, kovacs.sara, scenario="bank_security")["call_id"]
    answer(client, call_id)
    call_back = phone_state(client, kovacs.sara)["shield"]["call_back"]
    assert (call_back["member_id"], call_back["name"]) == (kovacs.jon, "Jon")


def test_the_organiser_on_a_library_voice_call_backs_to_another_member(client, kovacs):
    call_id = start_shield_call(client, kovacs.family, kovacs.jon, scenario="police")["call_id"]
    answer(client, call_id)
    assert phone_state(client, kovacs.jon)["shield"]["call_back"]["member_id"] == kovacs.sara


def test_call_back_number_comes_from_member_joins(client, kovacs, live_shield_call):
    with new_session() as db:
        db.execute(text("CREATE TABLE IF NOT EXISTS member_joins "
                        "(member_id TEXT PRIMARY KEY, joined_at TEXT, phone_number TEXT)"))
        try:
            db.execute(text("INSERT INTO member_joins (member_id, joined_at, phone_number) VALUES (:m, :t, :p)"),
                       {"m": kovacs.jon, "t": now_iso(), "p": "+370 600 00000"})
            db.commit()
        except Exception:  # track 1's real table may need more columns after the merge
            pytest.skip("member_joins needs more columns than this test writes")
    assert phone_state(client, kovacs.sara)["shield"]["call_back"]["phone_number"] == "+370 600 00000"


def test_join_phone_number_is_none_without_the_table_or_row(client, kovacs):
    assert shield.join_phone_number(kovacs.jon) is None


def test_the_shield_switched_off_shows_nothing_and_alerts_nobody(client, kovacs, live_shield_call):
    with new_session() as db:
        db.add(ProtectionSettings(family_id=kovacs.family["family_id"], shield_enabled=False))
        db.commit()
    assert store_risk(live_shield_call, risk_data("red", ["money_request"]))
    assert phone_state(client, kovacs.sara)["shield"] is None
    assert messages_of(kovacs.jon) == []


# ---------------------------------------------------------------- the automatic family alert


def test_a_red_risk_event_alerts_the_family_exactly_once(client, kovacs, live_shield_call):
    store_risk(live_shield_call, risk_data("yellow", ["new_number"]))
    assert messages_of(kovacs.jon) == [] and messages_of(kovacs.ana) == []

    store_risk(live_shield_call, risk_data("red", ["new_number", "money_request"]))
    assert [(m.kind, m.text) for m in messages_of(kovacs.jon)] == [
        ("alert", "Sara is on a call from someone pretending to be you. Call them now.")]
    assert [(m.kind, m.text) for m in messages_of(kovacs.ana)] == [
        ("alert", "Sara is on a call that sounds like a scam. Call them now on their usual number.")]
    assert messages_of(kovacs.sara) == []
    with new_session() as db:
        row = db.get(CallShield, live_shield_call)
        assert (row.alerted_at is not None, row.alert_level) == (True, "red")
    alerts = [e for e in events.list_events(live_shield_call) if e["type"] == "shield.alert"]
    assert [alert["data"] for alert in alerts] == [{"alerted": 2, "level": "red"}]

    # Later checks stay red, and nothing is sent again.
    store_risk(live_shield_call, risk_data("red", ["new_number", "money_request", "secrecy"]))
    assert shield.on_risk(live_shield_call, risk_data("red", ["money_request"])) is None
    assert len(messages_of(kovacs.jon)) == 1 and len(messages_of(kovacs.ana)) == 1
    assert event_types(live_shield_call).count("shield.alert") == 1


def test_alerts_skip_members_who_left(client, kovacs, live_shield_call):
    update_member(kovacs.ana, opted_out_at=now_iso())
    assert shield.on_risk(live_shield_call, events.publish(live_shield_call, "risk",
                                                          risk_data("red", ["money_request"]))["data"]) == 1
    assert messages_of(kovacs.ana) == []


def test_a_library_voice_alert_says_nobody_is_imitated(client, kovacs):
    call_id = start_shield_call(client, kovacs.family, kovacs.sara, scenario="bank_security")["call_id"]
    answer(client, call_id)
    store_risk(call_id, risk_data("red", ["asks_for_code"]))
    general = "Sara is on a call that sounds like a scam. Call them now on their usual number."
    assert [m.text for m in messages_of(kovacs.jon)] == [general]
    assert [m.text for m in messages_of(kovacs.ana)] == [general]


def test_the_alert_reaches_the_phone_and_the_family_page(client, kovacs, live_shield_call):
    store_risk(live_shield_call, risk_data("red", ["money_request"]))
    messages = phone_state(client, kovacs.ana)["messages"]
    assert [(m["kind"], m["text"]) for m in messages] == [
        ("alert", "Sara is on a call that sounds like a scam. Call them now on their usual number.")]
    family = client.get(f"/api/families/{kovacs.family['family_id']}")
    assert family.status_code == 200, family.text
    assert "alert" in [item["kind"] for item in family.json()["week"]]


def test_the_call_view_shows_the_alert(client, kovacs, live_shield_call):
    assert client.get(f"/api/calls/{live_shield_call}").json()["shield"] == {
        "alerted": 0, "alerted_at": None, "alert_level": None}
    store_risk(live_shield_call, risk_data("red", ["money_request"]))
    view = client.get(f"/api/calls/{live_shield_call}").json()
    assert (view["shield"]["alerted"], view["shield"]["alert_level"]) == (2, "red")
    assert view["shield"]["alerted_at"] is not None
    assert view["kind"] == "practice"  # scored like any practice


async def test_the_live_risk_check_triggers_the_alert(client, kovacs, live_shield_call, monkeypatch):
    async def fake_check(turns, previous=None):
        return risk.combine(previous, ["money_request"], "Asks for money", "risk.v1", len(turns) - 1)

    monkeypatch.setattr(risk, "check_risk", fake_check)
    training = start_practice(client, kovacs.ana, kovacs.jon)
    answer(client, training)
    for call_id in (live_shield_call, training):
        response = client.post(f"/api/calls/{call_id}/events",
                               json={"events": [{"type": "turn", "speaker": "agent", "text": "Send me 400 euros."}]})
        assert response.status_code == 200
        assert (await live_risk.check_once(call_id))["level"] == "red"
    assert event_types(live_shield_call)[-2:] == ["risk", "shield.alert"]
    assert "shield.alert" not in event_types(training)
    assert len(messages_of(kovacs.jon)) == 1  # from the shield call only
    assert phone_state(client, kovacs.sara)["shield"]["warn"] is True
    assert phone_state(client, kovacs.ana)["shield"] is None


def test_end_to_end_through_the_events_endpoint(client, kovacs, live_shield_call, monkeypatch):
    """The demo path: the phone posts the caller's line, the live risk check
    runs in the background (no model key: the keyword fallback), and within
    moments the phone warns and the family is alerted."""
    monkeypatch.setenv("RISK_CHECK_ENABLED", "true")
    get_settings.cache_clear()
    live_risk._running.clear()
    live_risk._again.clear()
    line = "Mum? It's me, I dropped my phone. Can you send me 400 euros today, to my friend's account?"
    response = client.post(f"/api/calls/{live_shield_call}/events",
                           json={"events": [{"type": "turn", "speaker": "agent", "text": line}]})
    assert response.status_code == 200
    deadline = time.monotonic() + 5
    state = phone_state(client, kovacs.sara)["shield"]
    while not state["warn"] and time.monotonic() < deadline:
        time.sleep(0.05)
        state = phone_state(client, kovacs.sara)["shield"]
    assert (state["warn"], state["level"]) == (True, "red")
    assert state["message"] == "This sounds like a scam. Hang up and call Jon on their usual number."
    assert [m["kind"] for m in phone_state(client, kovacs.jon)["messages"]] == ["alert"]
    assert event_types(live_shield_call)[-2:] == ["risk", "shield.alert"]
    live_risk._running.clear()


def test_on_risk_never_raises(client, kovacs, live_shield_call, monkeypatch):
    def broken(*_args, **_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(shield, "alert_messages", broken)
    assert shield.on_risk(live_shield_call, risk_data("red", ["money_request"])) is None
    with new_session() as db:  # rolled back: the next red event may still alert
        assert db.get(CallShield, live_shield_call).alerted_at is None
    assert shield.on_risk("call_nobody", risk_data("red", ["money_request"])) is None


def test_phone_shield_never_raises(client, kovacs, live_shield_call, monkeypatch):
    monkeypatch.setattr(shield, "latest_risk", lambda *_: 1 / 0)
    body = phone_state(client, kovacs.sara)
    assert body["shield"] is None


# ---------------------------------------------------------------- the manual alert


def test_manual_alert_tells_the_family(client, kovacs):
    response = client.post(f"/api/members/{kovacs.sara}/alert", json={})
    assert response.status_code == 200
    assert response.json() == {"alerted": 2}
    general = "Sara is on a call that sounds like a scam. Call them now on their usual number."
    assert [(m.kind, m.text) for m in messages_of(kovacs.jon)] == [("alert", general)]
    assert [(m.kind, m.text) for m in messages_of(kovacs.ana)] == [("alert", general)]


def test_manual_alert_with_a_claimed_relative(client, kovacs):
    assert client.post(f"/api/members/{kovacs.sara}/alert",
                       json={"claimed_member_id": kovacs.jon}).json() == {"alerted": 2}
    assert [m.text for m in messages_of(kovacs.jon)] == [
        "Sara is on a call from someone pretending to be you. Call them now."]
    # A double tap writes nothing more, and still counts the family as alerted.
    assert client.post(f"/api/members/{kovacs.sara}/alert",
                       json={"claimed_member_id": kovacs.jon}).json() == {"alerted": 2}
    assert len(messages_of(kovacs.jon)) == 1 and len(messages_of(kovacs.ana)) == 1


def test_manual_alert_without_a_body(client, kovacs):
    assert client.post(f"/api/members/{kovacs.sara}/alert").json() == {"alerted": 2}


def test_manual_alert_errors(client, kovacs, make_family):
    other = ids(make_family())[0]
    response = client.post(f"/api/members/{kovacs.sara}/alert", json={"claimed_member_id": other})
    assert (response.status_code, response.json()["error"]["code"]) == (404, "not_found")
    assert client.post("/api/members/mem_nobody/alert", json={}).status_code == 404
    update_member(kovacs.sara, opted_out_at=now_iso())
    response = client.post(f"/api/members/{kovacs.sara}/alert", json={})
    assert (response.status_code, response.json()["error"]["code"]) == (409, "consent_missing")
    assert messages_of(kovacs.jon) == []


# ---------------------------------------------------------------- web push


def test_the_alert_push_is_urgent(client, kovacs, live_shield_call, monkeypatch):
    monkeypatch.setenv("VAPID_PUBLIC_KEY", "BFakePublicKeyForTestsOnly")
    monkeypatch.setenv("VAPID_PRIVATE_KEY", "fake-private-key-for-tests-only")
    get_settings.cache_clear()
    pushes: list[dict] = []
    monkeypatch.setattr(push, "send", lambda info, payload, ttl, urgency: pushes.append(
        {"payload": payload, "urgency": urgency}) or 201)
    monkeypatch.setattr(push, "start_in_background", lambda job, *args: job(*args))
    subscription = {"endpoint": "https://fcm.googleapis.com/fcm/send/device-1", "expirationTime": None,
                    "keys": {"p256dh": b64url(b"\x04" + bytes([1]) * 64), "auth": b64url(bytes([1]) * 16)}}
    assert client.post(f"/api/members/{kovacs.jon}/push-subscription", json=subscription).status_code == 200
    store_risk(live_shield_call, risk_data("red", ["money_request"]))
    assert len(pushes) == 1
    assert pushes[0]["urgency"] == "high"
    assert (pushes[0]["payload"]["title"], pushes[0]["payload"]["kind"]) == ("Family alert", "alert")


def test_a_bare_practice_row_is_not_a_shield_call(client, kovacs):
    with new_session() as db:
        call = Call(id=new_call_id(), family_id=kovacs.family["family_id"], kind="practice",
                    target_member_id=kovacs.sara, status="in_progress", answered_at=now_iso(), created_at=now_iso())
        db.add(call)
        db.commit()
        assert shield.is_shield_call(db, call.id) is False
        assert shield.active_shield_call(db, kovacs.sara) is None

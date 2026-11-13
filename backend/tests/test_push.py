"""Web Push: the subscription endpoints, when a push is sent and what it
carries, and what the push services' answers do. The sender is always
faked (push.send, or pywebpush.webpush under it), so nothing here reaches
the network."""

import base64
import importlib.util
import json
import os
import threading
import time
from datetime import timedelta
from types import SimpleNamespace

import pytest
from py_vapid import Vapid
from pywebpush import WebPushException
from sqlalchemy import select

from app import schemas
from app.config import BACKEND_DIR, Settings, get_settings
from app.db import new_session, now_iso, to_iso, utcnow
from app.models import Call, Member, Message, PushSubscription
from app.services import briefs, pipeline, push, scheduler, sessions

FAKE_PUBLIC_KEY = "BFakePublicKeyForTestsOnly"
FAKE_PRIVATE_KEY = "fake-private-key-for-tests-only"


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def subscription(n: int = 1, host: str = "fcm.googleapis.com") -> dict:
    """A PushSubscription.toJSON() as a browser sends it."""
    return {
        "endpoint": f"https://{host}/fcm/send/device-{n}",
        "expirationTime": None,
        "keys": {"p256dh": b64url(b"\x04" + bytes([n]) * 64), "auth": b64url(bytes([n]) * 16)},
    }


def members(family) -> tuple[str, str]:
    return family["members"][0]["id"], family["members"][1]["id"]


def stored() -> list[PushSubscription]:
    with new_session() as db:
        return list(db.scalars(select(PushSubscription).order_by(PushSubscription.id)))


@pytest.fixture
def push_on(monkeypatch) -> None:
    monkeypatch.setenv("VAPID_PUBLIC_KEY", FAKE_PUBLIC_KEY)
    monkeypatch.setenv("VAPID_PRIVATE_KEY", FAKE_PRIVATE_KEY)
    get_settings.cache_clear()


@pytest.fixture
def sent(monkeypatch) -> SimpleNamespace:
    """A fake push.send that records each push and answers with
    state.answers[endpoint] (default 201), and deliveries run at once."""
    state = SimpleNamespace(pushes=[], answers={})

    def fake_send(info, payload, ttl, urgency):
        state.pushes.append({"endpoint": info["endpoint"], "payload": payload, "ttl": ttl, "urgency": urgency})
        answer = state.answers.get(info["endpoint"], 201)
        if isinstance(answer, Exception):
            raise answer
        return answer

    monkeypatch.setattr(push, "send", fake_send)
    monkeypatch.setattr(push, "start_in_background", lambda job, *args: job(*args))
    return state


@pytest.fixture
def fakes(monkeypatch) -> None:
    """Tracks A and C faked, as in test_phone.py."""

    async def fake_build_brief(db, target, voice_member, scenario_key, difficulty):
        return briefs.BuiltBrief(variables={"target_name": target.name}, caller_label="Unknown number",
                                 caller_number="+00 600 555 0142")

    async def fake_build_session(db, call):
        return schemas.Session(kind=call.kind, conversation_token="tok", conversation_id="conv_test",
                               overrides={}, dynamic_variables={}, max_seconds=schemas.MAX_SECONDS[call.kind])

    async def fake_after_call(call_id):
        return None

    monkeypatch.setattr(briefs, "build_brief", fake_build_brief)
    monkeypatch.setattr(sessions, "build_session", fake_build_session)
    monkeypatch.setattr(pipeline, "after_call", fake_after_call)


def ring_practice(client, member_id: str, **body) -> str:
    client.get(f"/api/members/{member_id}/phone-state")  # the page is open
    response = client.post("/api/practice-calls", json={"target_member_id": member_id, **body})
    assert response.status_code == 201, response.text
    return response.json()["call_id"]


# ---------------------------------------------------------------- settings and the key generator


def test_the_private_key_stays_out_of_repr():
    settings = Settings(_env_file=None, vapid_public_key="pub-key", vapid_private_key="vapid-not-real")
    assert "vapid-not-real" not in repr(settings)
    assert settings.push_enabled
    assert not Settings(_env_file=None, vapid_public_key="pub-key").push_enabled


def test_make_vapid_keys_prints_a_matching_pair_and_writes_nothing(capsys, tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location("make_vapid_keys", BACKEND_DIR / "scripts" / "make_vapid_keys.py")
    script = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(script)
    workdir = tmp_path / "cwd"
    workdir.mkdir()
    monkeypatch.chdir(workdir)
    script.main()
    lines = capsys.readouterr().out.splitlines()
    assert [line.split("=", 1)[0] for line in lines] == ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"]
    public, private = (line.split("=", 1)[1] for line in lines)
    assert os.listdir(workdir) == []
    raw_public = base64.urlsafe_b64decode(public + "=" * (-len(public) % 4))
    assert len(raw_public) == 65 and raw_public[0] == 4  # what applicationServerKey takes
    assert "=" not in public and "+" not in public and "/" not in public
    vapid = Vapid.from_string(private_key=private)  # pywebpush reads the private key like this
    assert vapid.public_key.public_numbers().x == int.from_bytes(raw_public[1:33], "big")


# ---------------------------------------------------------------- the endpoints


def test_public_key_says_push_is_off_without_keys(client):
    assert client.get("/api/push/public-key").json() == {"enabled": False, "public_key": None}


def test_public_key_when_push_is_on(client, push_on):
    assert client.get("/api/push/public-key").json() == {"enabled": True, "public_key": FAKE_PUBLIC_KEY}


def test_subscribe_upserts_by_endpoint_and_unsubscribes(client, make_family):
    sara, jon = members(make_family())
    assert client.post(f"/api/members/{sara}/push-subscription", json=subscription(1)).json() == {"ok": True}
    assert client.post(f"/api/members/{sara}/push-subscription", json=subscription(2)).status_code == 200
    rows = stored()
    assert [(row.member_id, row.endpoint, row.failure_count) for row in rows] == [
        (sara, subscription(1)["endpoint"], 0), (sara, subscription(2)["endpoint"], 0)]
    assert rows[0].p256dh == subscription(1)["keys"]["p256dh"] and rows[0].created_at

    # the same browser again, now on Jon's page, with new keys: one row, moved to Jon
    with new_session() as db:
        db.get(PushSubscription, rows[0].id).failure_count = 3
        db.commit()
    again = {**subscription(1), "keys": subscription(7)["keys"]}
    assert client.post(f"/api/members/{jon}/push-subscription", json=again).status_code == 200
    rows = stored()
    assert len(rows) == 2
    assert (rows[0].member_id, rows[0].p256dh, rows[0].auth, rows[0].failure_count) == (
        jon, subscription(7)["keys"]["p256dh"], subscription(7)["keys"]["auth"], 0)

    # unsubscribe: only the member's own endpoint, idempotent
    assert client.request("DELETE", f"/api/members/{sara}/push-subscription",
                          json={"endpoint": subscription(1)["endpoint"]}).json() == {"ok": True}
    assert len(stored()) == 2, "Sara cannot remove Jon's subscription"
    assert client.request("DELETE", f"/api/members/{jon}/push-subscription", json=again).status_code == 200
    assert [row.member_id for row in stored()] == [sara]
    assert client.request("DELETE", f"/api/members/{jon}/push-subscription",
                          json={"endpoint": subscription(1)["endpoint"]}).status_code == 200
    assert client.delete(f"/api/members/{sara}/push-subscription").json() == {"ok": True}  # no body: all
    assert stored() == []


def test_subscription_endpoints_404_for_an_unknown_member(client):
    for response in (client.post("/api/members/mem_nope/push-subscription", json=subscription()),
                     client.delete("/api/members/mem_nope/push-subscription")):
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"


@pytest.mark.parametrize("change", [
    lambda s: s.pop("keys"),
    lambda s: s.pop("endpoint"),
    lambda s: s["keys"].pop("auth"),
    lambda s: s.update(endpoint="http://fcm.googleapis.com/fcm/send/x"),
    lambda s: s.update(endpoint="https://example.com/push/x"),
    lambda s: s.update(endpoint="https://storage.googleapis.com/x"),
    lambda s: s.update(endpoint="https://fcm.googleapis.com.evil.example/x"),
    lambda s: s.update(endpoint="https://evil.example#.googleapis.com"),
    lambda s: s.update(endpoint="https://" + "a" * 2050 + ".push.apple.com/x"),
    lambda s: s["keys"].update(p256dh=b64url(b"\x04" + b"\x01" * 30)),
    lambda s: s["keys"].update(p256dh=b64url(b"\x02" + b"\x01" * 64)),
    lambda s: s["keys"].update(auth=b64url(b"\x01" * 15)),
    lambda s: s["keys"].update(auth="not base64!"),
])
def test_a_bad_subscription_is_422_with_the_error_shape(client, make_family, change):
    sara, _ = members(make_family())
    body = subscription()
    change(body)
    response = client.post(f"/api/members/{sara}/push-subscription", json=body)
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "invalid_request" and error["message"].startswith("body")
    assert stored() == []


def test_the_push_services_the_phones_use_are_taken(client, make_family):
    sara, _ = members(make_family())
    for n, host in enumerate(["fcm.googleapis.com", "web.push.apple.com",
                              "updates.push.services.mozilla.com", "wns2-par02p.notify.windows.com"], start=1):
        assert client.post(f"/api/members/{sara}/push-subscription", json=subscription(n, host)).status_code == 200
    padded = subscription(9)
    padded["keys"] = {key: value + "=" * (-len(value) % 4) for key, value in padded["keys"].items()}
    assert client.post(f"/api/members/{sara}/push-subscription", json=padded).status_code == 200
    assert len(stored()) == 5


# ---------------------------------------------------------------- when a push goes out, and what it says


def test_a_ringing_practice_pushes_what_the_ringing_screen_shows(client, make_family, fakes, push_on, sent):
    sara, jon = members(make_family())
    client.post(f"/api/members/{sara}/push-subscription", json=subscription(1))
    client.post(f"/api/members/{sara}/push-subscription", json=subscription(2))
    client.post(f"/api/members/{jon}/push-subscription", json=subscription(3))
    call_id = ring_practice(client, sara, scenario="police", difficulty=2)

    caller = client.get(f"/api/members/{sara}/phone-state").json()["incoming_call"]["caller"]
    expected = {"type": "incoming_call", "call_id": call_id, "title": caller["label"],
                "body": f"Incoming call · {caller['number']}", "url": f"/phone/{sara}", "tag": call_id}
    assert [p["endpoint"] for p in sent.pushes] == [subscription(1)["endpoint"], subscription(2)["endpoint"]]
    assert all(p["payload"] == expected for p in sent.pushes)
    assert all((p["ttl"], p["urgency"]) == (scheduler.RING_SECONDS, "high") for p in sent.pushes)
    text = json.dumps(sent.pushes[0]["payload"]).lower()
    assert "practice" not in text and "police" not in text and "kind" not in text
    assert all(row.last_success_at and row.failure_count == 0 for row in stored()[:2])
    assert stored()[2].last_success_at is None, "Jon's phone is not told"

    # answering is not a new ring
    client.post(f"/api/calls/{call_id}/answer")
    assert len(sent.pushes) == 2


def test_a_welcome_call_pushes_its_caller(client, make_family, push_on, sent):
    sara, _ = members(make_family())
    client.post(f"/api/members/{sara}/push-subscription", json=subscription())
    client.get(f"/api/members/{sara}/phone-state")
    call_id = client.post(f"/api/members/{sara}/welcome-call").json()["call_id"]
    assert [p["payload"] for p in sent.pushes] == [{
        "type": "incoming_call", "call_id": call_id, "title": "Callback",
        "body": "Incoming call · +00 600 555 0100", "url": f"/phone/{sara}", "tag": call_id}]


async def test_a_scheduled_practice_pushes_when_the_scheduler_rings_it(client, make_family, fakes, push_on, sent):
    sara, _ = members(make_family())
    client.post(f"/api/members/{sara}/push-subscription", json=subscription())
    call_id = ring_practice(client, sara, delay_seconds=60)
    assert sent.pushes == [], "a scheduled call is not ringing yet"
    with new_session() as db:
        await scheduler.tick(db, utcnow() + timedelta(seconds=61))
    assert [p["payload"]["call_id"] for p in sent.pushes] == [call_id]


def test_a_callback_notice_pushes_to_its_recipient(client, make_family, fakes, push_on, sent):
    family = make_family()
    sara, jon = members(family)
    client.post(f"/api/members/{sara}/push-subscription", json=subscription(1))
    client.post(f"/api/members/{jon}/push-subscription", json=subscription(2))
    call_id = ring_practice(client, sara, scenario="police")
    client.post(f"/api/calls/{call_id}/answer")
    client.post(f"/api/calls/{call_id}/end", json={"ended_by": "agent"})
    sent.pushes.clear()

    assert client.post(f"/api/members/{sara}/family-line").status_code == 200
    message = client.get(f"/api/members/{jon}/phone-state").json()["messages"][0]
    assert [(p["endpoint"], p["payload"], p["urgency"]) for p in sent.pushes] == [(
        subscription(2)["endpoint"],
        {"type": "message", "message_id": message["id"], "kind": "callback_notice", "title": "Family number",
         "body": "Sara called the family number after a practice.", "url": f"/phone/{jon}",
         "tag": f"message_{message['id']}"},
        "normal")]
    assert sent.pushes[0]["ttl"] == push.MESSAGE_TTL_SECONDS


def test_any_committed_message_pushes_and_a_rolled_back_one_does_not(client, make_family, push_on, sent):
    sara, _ = members(make_family())
    client.post(f"/api/members/{sara}/push-subscription", json=subscription())
    with new_session() as db:
        db.add(Message(member_id=sara, kind="weekly", text="Never mind.", created_at=now_iso()))
        db.flush()
        db.rollback()
        db.add(Message(member_id=sara, kind="weekly", text="  This week:\n callers " + "x" * 300,
                       created_at=now_iso()))
        db.commit()
    assert len(sent.pushes) == 1
    payload = sent.pushes[0]["payload"]
    assert (payload["kind"], payload["title"]) == ("weekly", "This week")
    assert payload["body"].startswith("This week: callers xxx") and payload["body"].endswith("…")
    assert len(payload["body"]) == push.BODY_MAX_CHARS


def test_no_push_while_push_is_off(client, make_family, fakes, sent):
    sara, jon = members(make_family())
    client.post(f"/api/members/{sara}/push-subscription", json=subscription())
    ring_practice(client, sara)
    with new_session() as db:
        db.add(Message(member_id=sara, kind="reminder", text="Agree a family word.", created_at=now_iso()))
        db.commit()
    assert sent.pushes == []


def test_no_push_to_a_member_who_opted_out(client, make_family, push_on, sent):
    sara, _ = members(make_family())
    client.post(f"/api/members/{sara}/push-subscription", json=subscription())
    with new_session() as db:
        db.get(Member, sara).opted_out_at = now_iso()
        db.add(Message(member_id=sara, kind="weekly", text="Hello", created_at=now_iso()))
        db.commit()
    assert sent.pushes == []


# ---------------------------------------------------------------- the push services' answers


def test_404_and_410_delete_the_subscription_other_errors_count(client, make_family, push_on, sent):
    sara, _ = members(make_family())
    for n in (1, 2, 3, 4):
        client.post(f"/api/members/{sara}/push-subscription", json=subscription(n))
    sent.answers = {subscription(1)["endpoint"]: 410, subscription(2)["endpoint"]: 404,
                    subscription(3)["endpoint"]: 500, subscription(4)["endpoint"]: ConnectionError("down")}

    def message() -> None:
        with new_session() as db:
            db.add(Message(member_id=sara, kind="weekly", text="Hello", created_at=now_iso()))
            db.commit()

    message()
    assert len(sent.pushes) == 4
    assert [(row.endpoint, row.failure_count, row.last_success_at) for row in stored()] == [
        (subscription(3)["endpoint"], 1, None), (subscription(4)["endpoint"], 1, None)]
    message()
    assert [row.failure_count for row in stored()] == [2, 2]
    sent.answers = {}
    message()
    assert all(row.failure_count == 0 and row.last_success_at for row in stored())


def test_a_broken_sender_never_fails_the_request(client, make_family, fakes, push_on, sent, monkeypatch):
    sara, _ = members(make_family())
    client.post(f"/api/members/{sara}/push-subscription", json=subscription())

    def broken_start(job, *args):
        raise RuntimeError("no threads")

    monkeypatch.setattr(push, "start_in_background", broken_start)
    call_id = ring_practice(client, sara)
    assert client.get(f"/api/calls/{call_id}").json()["status"] == "ringing"


def test_sending_runs_in_the_background(client, make_family, fakes, push_on, monkeypatch):
    """The real start_in_background: the request answers while the push
    service is still being waited for."""
    sara, _ = members(make_family())
    client.post(f"/api/members/{sara}/push-subscription", json=subscription())
    release, done = threading.Event(), threading.Event()

    def slow_send(info, payload, ttl, urgency):
        release.wait(5)
        return 201

    monkeypatch.setattr(push, "send", slow_send)
    real_deliver = push.deliver
    monkeypatch.setattr(push, "deliver", lambda *args: (real_deliver(*args), done.set()))
    try:
        ring_practice(client, sara)
        assert not done.is_set(), "the request did not wait for the push"
    finally:
        release.set()
    assert done.wait(5)
    assert stored()[0].last_success_at is not None


# ---------------------------------------------------------------- send() over pywebpush


def test_send_calls_pywebpush_with_the_settings(push_on, monkeypatch):
    calls: list[dict] = []

    def fake_webpush(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(status_code=201)

    monkeypatch.setattr(push, "webpush", fake_webpush)
    info = {"endpoint": subscription()["endpoint"], "keys": subscription()["keys"]}
    assert push.send(info, {"type": "message", "body": "Hi"}, 60, "high") == 201
    assert push.send(info, {"type": "message"}, 60, "high") == 201
    first = calls[0]
    assert first["subscription_info"] == info and json.loads(first["data"]) == {"type": "message", "body": "Hi"}
    assert first["vapid_private_key"] == FAKE_PRIVATE_KEY
    assert first["vapid_claims"] == {"sub": "mailto:callback@example.com"}
    assert first["vapid_claims"] is not calls[1]["vapid_claims"], "webpush writes aud into the claims"
    assert (first["ttl"], first["headers"], first["timeout"]) == (60, {"Urgency": "high"}, push.SEND_TIMEOUT_SECONDS)


def test_send_returns_the_push_services_error_status(push_on, monkeypatch):
    def gone(**kwargs):
        raise WebPushException("Push failed: 410 Gone", response=SimpleNamespace(status_code=410, text=""))

    monkeypatch.setattr(push, "webpush", gone)
    assert push.send(subscription(), {}, 60, "high") == 410

    def no_answer(**kwargs):
        raise WebPushException("no response")

    monkeypatch.setattr(push, "webpush", no_answer)
    with pytest.raises(WebPushException):
        push.send(subscription(), {}, 60, "high")


def test_send_uses_the_subject_setting(push_on, monkeypatch):
    monkeypatch.setenv("VAPID_SUBJECT", "https://callback.example")
    get_settings.cache_clear()
    seen: list[dict] = []
    monkeypatch.setattr(push, "webpush", lambda **kwargs: seen.append(kwargs) or SimpleNamespace(status_code=201))
    push.send(subscription(), {}, 60, "normal")
    assert seen[0]["vapid_claims"] == {"sub": "https://callback.example"}


def test_a_call_that_stopped_ringing_is_not_pushed(client, make_family, fakes, push_on, sent, monkeypatch):
    sara, _ = members(make_family())
    client.post(f"/api/members/{sara}/push-subscription", json=subscription())
    queued: list[tuple] = []
    monkeypatch.setattr(push, "start_in_background", lambda job, *args: queued.append((job, args)))
    call_id = ring_practice(client, sara)
    client.post(f"/api/calls/{call_id}/decline")
    for job, args in queued:  # the delivery runs after the decline
        job(*args)
    assert sent.pushes == []
    with new_session() as db:
        assert db.get(Call, call_id).status == "declined"

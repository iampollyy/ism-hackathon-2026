"""Track B tests: the laptop's server-sent event stream. OWNER: track B.

Starlette's TestClient streams responses, so these read the endless stream
in-process, a few lines at a time, without a real server."""

import json
import time
from collections.abc import Iterator

from app import events
from app.db import new_session, now_iso
from app.ids import new_call_id
from app.models import Call
from app.routers import streams


def make_call(family) -> str:
    with new_session() as db:
        call = Call(id=new_call_id(), family_id=family["family_id"], kind="practice",
                    target_member_id=family["members"][0]["id"], status="in_progress",
                    answered_at=now_iso(), created_at=now_iso())
        db.add(call)
        db.commit()
        return call.id


def read_blocks(lines: Iterator[str], count: int) -> list[dict[str, str]]:
    """The next `count` blocks (events or comments), each as {field: value}."""
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


def test_unknown_call_is_404(client):
    response = client.get("/api/calls/call_nope/events")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_parse_last_event_id():
    assert [streams.parse_last_event_id(v) for v in (None, "", "3", " 7 ", "x", "-2")] == [0, 0, 3, 7, 0, 0]


def test_replays_then_streams_live_then_cleans_up(client, make_family):
    call_id = make_call(make_family())
    events.publish(call_id, "call.status", {"status": "in_progress"})
    events.publish(call_id, "turn", {"speaker": "agent", "text": "Mum? It's me."})
    with client.stream("GET", f"/api/calls/{call_id}/events") as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        assert response.headers["cache-control"] == "no-cache"
        assert response.headers["x-accel-buffering"] == "no"
        lines = response.iter_lines()
        replay = read_blocks(lines, 2)
        assert [(b["id"], b["event"]) for b in replay] == [("1", "call.status"), ("2", "turn")]
        assert json.loads(replay[1]["data"])["text"] == "Mum? It's me."
        assert "t" in json.loads(replay[1]["data"])
        assert events.subscriber_count(call_id) == 1

        client.post(f"/api/calls/{call_id}/events", json={"events": [{"type": "tactic", "key": "urgency"}]})
        live = read_blocks(lines, 1)[0]
        assert (live["id"], live["event"]) == ("3", "tactic")
        assert json.loads(live["data"])["label"] == "Urgency"
    deadline = time.monotonic() + 3
    while events.subscriber_count(call_id) and time.monotonic() < deadline:
        time.sleep(0.05)
    assert events.subscriber_count(call_id) == 0


def test_resumes_after_last_event_id(client, make_family):
    call_id = make_call(make_family())
    for text in ("one", "two", "three"):
        events.publish(call_id, "turn", {"speaker": "agent", "text": text})
    with client.stream("GET", f"/api/calls/{call_id}/events", headers={"Last-Event-ID": "2"}) as response:
        block = read_blocks(response.iter_lines(), 1)[0]
    assert block["id"] == "3"
    assert json.loads(block["data"])["text"] == "three"


def test_sends_a_keep_alive_comment_when_idle(client, make_family, monkeypatch):
    monkeypatch.setattr(streams, "KEEPALIVE_SECONDS", 0.1)
    call_id = make_call(make_family())
    with client.stream("GET", f"/api/calls/{call_id}/events") as response:
        block = read_blocks(response.iter_lines(), 1)[0]
    assert block == {"comment": events.SSE_KEEPALIVE.strip()}
